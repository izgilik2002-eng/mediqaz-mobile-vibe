import { TRANSCRIPTION_MAX_AUDIO_SECONDS } from '@mediqaz/contracts'

import {
  RecordingTooLongError,
  SpeechNotRecognizedError,
  TranscriptionTimedOutError,
} from '../domain/errors'
import type { AudioTranscriber, AudioTranscription, FetchLike } from '../application/ports'
import { languageTagForLog } from './transcription-logging'

const transcriptionsEndpoint = 'https://api.openai.com/v1/audio/transcriptions'

/**
 * The provider answered, but the body is not the shape we know how to read —
 * unparseable, missing `text`, a renamed field, or an error envelope from
 * something sitting in front of OpenAI.
 *
 * Deliberately distinct from `SpeechNotRecognizedError`, exactly as
 * `DeepgramResponseError` is: this is a contract problem on their side and has
 * to keep mapping to a 5xx. Reporting it as an empty recording would send the
 * doctor to re-record audio that was never at fault, and would hide a real
 * outage behind a 4xx where alerting cannot see it.
 */
export class OpenAiResponseError extends Error {
  constructor(reason: string) {
    super(`OpenAI transcription response ${reason}`)
    this.name = 'OpenAiResponseError'
  }
}

type OpenAiTranscriptionBody = {
  text?: unknown
  language?: unknown
  languages?: unknown
  usage?: { type?: unknown; seconds?: unknown }
}

/**
 * OpenAI's `gpt-4o-transcribe` — what serves Kazakh and auto-detect, replacing
 * Deepgram's hosted Whisper on those two languages. Russian is untouched and
 * still streams through Nova-2.
 *
 * Three properties of this provider shape everything below:
 *
 * 1. It takes multipart form data, not a raw body, and it picks its decoder
 *    from the *filename* of the file part. Posting the same bytes without a
 *    plausible extension is a 400, so the recording's content type has to be
 *    translated into one.
 * 2. `json` is the only response format this model accepts. `verbose_json` —
 *    the one that carries `duration` and a detected language — is a 400 here
 *    and exists only on `whisper-1`. So there is normally no measured length to
 *    return, and the configured cap is enforced by the client's pre-upload
 *    check and the 25MB request limit instead of after the fact.
 * 3. Its refusal for an over-large file is a 413. Unlike our own timeout, that
 *    is a property of the recording, so the two stay strictly apart: a 413 is
 *    the provider's own budget, our timeout is the provider being slow.
 */
export function createOpenAiTranscriber({
  apiKey,
  language,
  model = 'gpt-4o-transcribe',
  maxAudioSeconds = TRANSCRIPTION_MAX_AUDIO_SECONDS,
  fetchImpl = fetch,
  // Carried over unchanged from the adapter this replaces. OpenAI's latency is
  // far steadier than Deepgram Whisper's one-second-to-three-minute swing, but
  // this deployment has no measurements of its own yet, so the ceiling starts
  // where the previous one was and moves after measurement rather than on a
  // guess. It is a ceiling, not an expected wait.
  timeoutMs = 300_000,
}: {
  apiKey: string
  /**
   * A concrete language code, or `null` to let the model detect it. Detection
   * picks the dominant language of the recording — it does not follow a doctor
   * who switches language mid-sentence.
   */
  language: string | null
  model?: string
  maxAudioSeconds?: number
  fetchImpl?: FetchLike
  timeoutMs?: number
}): AudioTranscriber {
  // One label for this adapter's language in every log line it writes, so a
  // log query for one outcome cannot silently miss another.
  const languageLabel = language ?? 'detect'

  return {
    async transcribe({ audio, contentType }): Promise<AudioTranscription> {
      // Every outcome that reaches this adapter is logged — the request never
      // starting, the provider refusing, and every classification of a 200.
      // Without that, the only visible symptom is the message the doctor read,
      // which is how a slow provider once spent a release masquerading as an
      // over-long recording.
      const startedAt = Date.now()
      const elapsed = () => Date.now() - startedAt

      const form = new FormData()
      // The filename is not cosmetic: it is the only place the provider learns
      // the container, and a missing or wrong extension is a 400.
      form.append('file', new Blob([audio], { type: contentType }), fileNameFor(contentType))
      form.append('model', model)
      form.append('response_format', 'json')
      if (language) form.append('language', language)

      let response: Response
      try {
        response = await fetchImpl(transcriptionsEndpoint, {
          method: 'POST',
          // Only the credential. Setting `Content-Type` by hand would strip the
          // multipart boundary fetch generates for the FormData body.
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'TimeoutError') {
          console.error('[openai-stt] provider did not answer within the timeout', {
            model,
            language: languageLabel,
            elapsedMs: elapsed(),
            timeoutMs,
          })
          throw new TranscriptionTimedOutError(timeoutMs)
        }

        console.error('[openai-stt] request failed before a response', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
          cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
        })
        throw cause
      }

      // 413 is the provider's own 25MB limit, which does track file length —
      // unlike our timeout above.
      if (response.status === 413) {
        console.error('[openai-stt] provider refused the recording as too large', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
          maxAudioSeconds,
        })
        throw new RecordingTooLongError(maxAudioSeconds)
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '<body could not be read>')
        console.error('[openai-stt] provider rejected the request', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
          status: response.status,
          body: body.slice(0, 500),
        })
        throw new Error(`OpenAI transcription failed with status ${response.status}`)
      }

      // Read as text first so a parse failure can still report how much came
      // back. `raw` itself is never logged.
      const raw = await response.text()

      let body: OpenAiTranscriptionBody
      try {
        body = JSON.parse(raw) as OpenAiTranscriptionBody
      } catch {
        console.error('[openai-stt] response body was not JSON', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
          contentType: response.headers.get('content-type') ?? '(absent)',
          bodyLength: raw.length,
        })
        throw new OpenAiResponseError('body was not JSON')
      }

      const transcript = body.text
      const durationSeconds = reportedDurationSeconds(body)

      // Nothing here logs the response body or the transcript. Consultation
      // speech must not reach Railway logs, which are read by more people, and
      // kept under someone else's retention policy, than the database is.
      // Lengths and counts are enough to tell the failure modes apart.
      console.log('[openai-stt] provider response', {
        model,
        language: languageLabel,
        detectedLanguage: languageTagForLog(detectedLanguage(body)),
        transcriptLength: typeof transcript === 'string' ? transcript.length : null,
        durationSeconds,
        elapsedMs: elapsed(),
      })

      // Checked before the emptiness test below, and in this order on purpose:
      // a body with no readable `text` at all is a contract break, and calling
      // it a silent recording would tell the doctor to fix audio that was never
      // the problem while hiding an outage behind a 4xx.
      if (typeof transcript !== 'string') {
        console.error('[openai-stt] response did not contain a text field', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
        })
        throw new OpenAiResponseError('did not contain a text field')
      }

      // The provider's answer to silence, and the structural equivalent of
      // Deepgram Whisper's `"alternatives": []`: a well-formed 200 carrying an
      // empty string. There was nothing to transcribe, and the provider is not
      // at fault.
      if (transcript.trim() === '') {
        console.error('[openai-stt] provider recognized no speech', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
        })
        throw new SpeechNotRecognizedError()
      }

      // Only reachable on a model that reports a length at all; `durationSeconds`
      // is 0 when unknown, which never trips this. A cap the doctor was told
      // about should hold where it can be checked, otherwise the number in the
      // app means nothing.
      if (durationSeconds > maxAudioSeconds) {
        console.error('[openai-stt] recording longer than the configured cap', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
          durationSeconds,
          maxAudioSeconds,
        })
        throw new RecordingTooLongError(maxAudioSeconds)
      }

      return { transcript, durationSeconds }
    },
  }
}

/**
 * `gpt-4o-transcribe` bills by token and reports no length, so this is 0 for
 * the model we run today. Duration-billed models — `whisper-1`, reachable
 * through the model override — report it here, and taking it when offered is
 * what keeps the stored consultation length honest rather than always 0.
 */
function reportedDurationSeconds(body: OpenAiTranscriptionBody): number {
  if (body.usage?.type !== 'duration') return 0

  const seconds = body.usage.seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 0
  return Math.round(seconds)
}

/**
 * The detected language, under either of the two names the API has used for it.
 * Sanitized by the caller before it reaches a log line — it is provider-
 * controlled text, and the whole reason it is logged is that Kazakh coming back
 * as Russian is the bug this provider was chosen to fix.
 */
function detectedLanguage(body: OpenAiTranscriptionBody): unknown {
  if (typeof body.language === 'string') return body.language
  return Array.isArray(body.languages) ? body.languages[0] : undefined
}

/**
 * The provider selects its decoder from the file extension, so the recording's
 * content type has to become one. Only the containers OpenAI documents are
 * mapped; anything else keeps its own subtype and is left for the provider to
 * accept or refuse with a 400, which surfaces as a generic failure rather than
 * a wrong transcript.
 */
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = Object.freeze({
  'audio/flac': 'flac',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mp3': 'mp3',
  'audio/mpeg': 'mp3',
  'audio/mpga': 'mpga',
  'audio/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
})

function fileNameFor(contentType: string): string {
  // `audio/webm;codecs=opus` is what a browser recording arrives as.
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  const subtype = mediaType.split('/')[1] ?? ''
  const extension =
    EXTENSION_BY_CONTENT_TYPE[mediaType] ?? (/^[a-z0-9]+$/.test(subtype) ? subtype : 'mp4')

  return `consultation.${extension}`
}
