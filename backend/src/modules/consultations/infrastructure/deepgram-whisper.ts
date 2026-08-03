import { TRANSCRIPTION_MAX_AUDIO_SECONDS } from '@mediqaz/contracts'

import { RecordingTooLongError } from '../domain/errors'
import type { AudioTranscriber, AudioTranscription, FetchLike } from '../application/ports'

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
 * 2. It processes the whole file against a hard timeout and answers 504 past
 *    it. Deepgram's own docs disagree on whether that budget is 10 or 20
 *    minutes, so the cap is configurable and defaults low; a 504 is translated
 *    into a "record a shorter visit" failure instead of a generic retry.
 */
export function createDeepgramWhisperTranscriber({
  apiKey,
  language,
  model = 'whisper-medium',
  maxAudioSeconds = TRANSCRIPTION_MAX_AUDIO_SECONDS,
  fetchImpl = fetch,
  timeoutMs = 180_000,
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

  return {
    async transcribe({ audio, contentType }): Promise<AudioTranscription> {
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
        // Our own timeout firing on a long file means the same thing to the
        // doctor as the provider's 504: the recording was too long to process.
        if (cause instanceof Error && cause.name === 'TimeoutError') {
          throw new RecordingTooLongError(maxAudioSeconds)
        }
        throw cause
      }

      if (response.status === 504) {
        throw new RecordingTooLongError(maxAudioSeconds)
      }

      if (!response.ok) {
        throw new Error(`Deepgram Whisper transcription failed with status ${response.status}`)
      }

      const payload = (await response.json()) as {
        metadata?: { duration?: unknown }
        results?: { channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }> }
      }
      const transcript = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript

      if (typeof transcript !== 'string' || transcript.trim() === '') {
        throw new Error('Deepgram Whisper response contained no transcript')
      }

      const duration = payload.metadata?.duration
      const durationSeconds =
        typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
          ? Math.round(duration)
          : 0

      // The provider answered, so the file was within its budget even if our
      // configured cap is lower — but a cap the doctor was told about should
      // hold, otherwise the number in the app means nothing.
      if (durationSeconds > maxAudioSeconds) {
        throw new RecordingTooLongError(maxAudioSeconds)
      }

      return { transcript, durationSeconds }
    },
  }
}
