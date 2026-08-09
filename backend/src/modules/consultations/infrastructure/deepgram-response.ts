import { SpeechNotRecognizedError } from '../domain/errors'
import type { AudioTranscription } from '../application/ports'
import { languageTagForLog } from './transcription-logging'

/**
 * The provider answered, but the body is not the pre-recorded shape we know how
 * to read — unparseable, missing `results`/`channels`, a renamed field, or an
 * error envelope from something sitting in front of Deepgram.
 *
 * Deliberately distinct from `SpeechNotRecognizedError`: this is a contract
 * problem on their side and has to keep mapping to a 5xx. Reporting it as an
 * empty recording would send the doctor to re-record audio that was never at
 * fault, and would hide a real outage behind a 4xx where alerting cannot see it.
 */
export class DeepgramResponseError extends Error {
  constructor(reason: string) {
    super(`Deepgram response ${reason}`)
    this.name = 'DeepgramResponseError'
  }
}

type DeepgramPrerecordedBody = {
  metadata?: { duration?: unknown }
  results?: {
    channels?: Array<{
      detected_language?: unknown
      alternatives?: Array<{ transcript?: unknown }>
    }>
  }
}

/**
 * Reads a Deepgram pre-recorded response into a transcript, or throws the
 * failure that matches what actually went wrong.
 *
 * Shared by every Deepgram adapter on purpose. The distinction between "the
 * provider heard nothing" and "the provider sent something we cannot read" is
 * the same for Nova-2 and for Whisper, and a doctor recording in Russian
 * deserves the same answer for a silent visit as one recording in Kazakh.
 * Keeping one copy is what stops those two paths drifting apart again.
 *
 * Nothing here logs the response body or the transcript. Consultation speech
 * must not reach Railway logs, which are read by more people, and kept under
 * someone else's retention policy, than the database is. Lengths and counts are
 * enough to tell the failure modes apart.
 */
export async function readDeepgramTranscription(
  response: Response,
  context: {
    model: string
    language: string
    startedAt: number
    /**
     * Kept per-adapter (`whisper`, `nova2`) rather than a shared `deepgram`
     * label, so an existing Railway filter or saved query built on one
     * adapter's log prefix keeps matching after this reader started serving
     * both — sharing the parsing logic must not also merge their log streams.
     */
    tag: string
  },
): Promise<AudioTranscription> {
  const { model, language, tag } = context
  const elapsedMs = () => Date.now() - context.startedAt

  // Read as text first so a parse failure can still report how much came back.
  // `raw` itself is never logged.
  const raw = await response.text()

  let body: DeepgramPrerecordedBody
  try {
    body = JSON.parse(raw) as DeepgramPrerecordedBody
  } catch {
    console.error(`[${tag}] response body was not JSON`, {
      model,
      language,
      elapsedMs: elapsedMs(),
      contentType: response.headers.get('content-type') ?? '(absent)',
      bodyLength: raw.length,
    })
    throw new DeepgramResponseError('body was not JSON')
  }

  const channel = body.results?.channels?.[0]
  const alternatives = channel?.alternatives
  // Checked as an array rather than indexed blindly, so a body that merely
  // looks indexable cannot pass for a well-formed one.
  const hasExpectedShape = Array.isArray(alternatives)
  const transcript = hasExpectedShape ? alternatives[0]?.transcript : undefined

  const duration = body.metadata?.duration
  const durationSeconds =
    typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
      ? Math.round(duration)
      : 0

  console.log(`[${tag}] provider response`, {
    model,
    language,
    detectedLanguage: languageTagForLog(channel?.detected_language),
    alternatives: hasExpectedShape ? alternatives.length : '(absent)',
    transcriptLength: typeof transcript === 'string' ? transcript.length : null,
    durationSeconds,
    elapsedMs: elapsedMs(),
  })

  if (!hasExpectedShape) {
    console.error(`[${tag}] response did not match the expected shape`, {
      model,
      language,
      elapsedMs: elapsedMs(),
    })
    throw new DeepgramResponseError('did not contain an alternatives array')
  }

  // Observed directly against this endpoint: on silence, or on audio it cannot
  // model, Whisper answers 200 with `"alternatives": []`, while Nova-2 answers
  // with one alternative holding an empty string. Both mean the same thing —
  // there was nothing to transcribe, and the provider is not at fault.
  if (alternatives.length === 0 || (typeof transcript === 'string' && transcript.trim() === '')) {
    console.error(`[${tag}] provider recognized no speech`, {
      model,
      language,
      elapsedMs: elapsedMs(),
      alternatives: alternatives.length,
    })
    throw new SpeechNotRecognizedError()
  }

  // Well-formed and non-empty, yet the first alternative carries no usable
  // `transcript` — a shape problem again, not silence.
  if (typeof transcript !== 'string') {
    console.error(`[${tag}] alternative carried no transcript field`, {
      model,
      language,
      elapsedMs: elapsedMs(),
      alternatives: alternatives.length,
    })
    throw new DeepgramResponseError('alternative did not contain a transcript')
  }

  return { transcript, durationSeconds }
}
