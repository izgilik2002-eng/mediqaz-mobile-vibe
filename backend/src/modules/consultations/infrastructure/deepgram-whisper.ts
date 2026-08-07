import { TRANSCRIPTION_MAX_AUDIO_SECONDS } from '@mediqaz/contracts'

import { RecordingTooLongError, TranscriptionTimedOutError } from '../domain/errors'
import type { AudioTranscriber, AudioTranscription, FetchLike } from '../application/ports'
import { readDeepgramTranscription } from './deepgram-response'

const listenEndpoint = 'https://api.deepgram.com/v1/listen'

/**
 * Deepgram's hosted Whisper — the only model on this provider that knows
 * Kazakh. Same API key as Nova-2, different `model` value.
 *
 * Two properties shape everything below:
 *
 * 1. Whisper is pre-recorded only. Deepgram states plainly that live streaming
 *    is not available with Whisper Cloud, and no other Deepgram model supports
 *    Kazakh — Nova-3's multilingual set does not include it either. So there is
 *    no streaming export here, and the router answers `null` for these
 *    languages rather than pretending.
 * 2. Its latency is wildly unpredictable. Measured against this very endpoint
 *    on a three-second file: 1s, 6s, 45s, 80s, and once past 180s with no
 *    answer at all — same key, same audio, minutes apart. Deepgram's own docs
 *    call Whisper "less scalable than all other Deepgram models". So a slow
 *    request says nothing about the recording, and the two failures are kept
 *    strictly apart: a 504 is the provider's own length budget, our timeout is
 *    the provider being slow.
 */
export function createDeepgramWhisperTranscriber({
  apiKey,
  language,
  model = 'whisper-medium',
  maxAudioSeconds = TRANSCRIPTION_MAX_AUDIO_SECONDS,
  fetchImpl = fetch,
  // Generous rather than tuned: with observed latency swinging between one
  // second and over three minutes for identical input, any tighter number is
  // guesswork that turns provider variance into a failed consultation.
  timeoutMs = 300_000,
}: {
  apiKey: string
  /**
   * A concrete language code, or `null` to let Whisper detect it. Detection
   * picks the dominant language of the recording — it does not follow a doctor
   * who switches language mid-sentence.
   */
  language: string | null
  model?: string
  maxAudioSeconds?: number
  fetchImpl?: FetchLike
  timeoutMs?: number
}): AudioTranscriber {
  const query = new URLSearchParams({
    model,
    smart_format: 'true',
    diarize: 'true',
    punctuate: 'true',
    ...(language ? { language } : { detect_language: 'true' }),
  }).toString()

  // One label for this adapter's language in every log line it writes, so a
  // log query for one outcome cannot silently miss another.
  const languageLabel = language ?? 'detect'

  return {
    async transcribe({ audio, contentType }): Promise<AudioTranscription> {
      // Every outcome that reaches this adapter is logged — the request never
      // starting, the provider refusing, and every classification of a 200 in
      // `readDeepgramTranscription`. Without that, the only visible symptom was
      // the message the doctor read, which is how a slow provider once spent a
      // release masquerading as an over-long recording.
      const startedAt = Date.now()
      const elapsed = () => Date.now() - startedAt

      let response: Response
      try {
        response = await fetchImpl(`${listenEndpoint}?${query}`, {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': contentType,
          },
          // A plain Uint8Array is ambiguous across the DOM/bun/undici BodyInit
          // typings this project pulls in; Blob is the one all three agree on.
          body: new Blob([audio]),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'TimeoutError') {
          console.error('[whisper] provider did not answer within the timeout', {
            model,
            language: languageLabel,
            elapsedMs: elapsed(),
            timeoutMs,
          })
          throw new TranscriptionTimedOutError(timeoutMs)
        }

        console.error('[whisper] request failed before a response', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
          cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
        })
        throw cause
      }

      // 504 is Deepgram's own processing budget, which does track file length —
      // unlike our timeout above.
      if (response.status === 504) {
        console.error('[whisper] provider reported its processing budget exceeded', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
          maxAudioSeconds,
        })
        throw new RecordingTooLongError(maxAudioSeconds)
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '<body could not be read>')
        console.error('[whisper] provider rejected the request', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
          status: response.status,
          body: body.slice(0, 500),
        })
        throw new Error(`Deepgram Whisper transcription failed with status ${response.status}`)
      }

      // Shared with the Nova-2 adapter: telling "the provider heard nothing"
      // apart from "the provider sent something we cannot read" is the same
      // problem in both, and a doctor recording in Russian deserves the same
      // answer for a silent visit as one recording in Kazakh.
      const reading = await readDeepgramTranscription(response, {
        model,
        language: languageLabel,
        startedAt,
        tag: 'whisper',
      })

      // The provider answered, so the file was within its budget even if our
      // configured cap is lower — but a cap the doctor was told about should
      // hold, otherwise the number in the app means nothing.
      if (reading.durationSeconds > maxAudioSeconds) {
        console.error('[whisper] recording longer than the configured cap', {
          model,
          language: languageLabel,
          elapsedMs: elapsed(),
          durationSeconds: reading.durationSeconds,
          maxAudioSeconds,
        })
        throw new RecordingTooLongError(maxAudioSeconds)
      }

      return reading
    },
  }
}
