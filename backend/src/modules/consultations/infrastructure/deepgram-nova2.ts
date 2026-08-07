import type { AudioTranscriber, AudioTranscription, FetchLike } from '../application/ports'
import { readDeepgramTranscription } from './deepgram-response'

const listenEndpoint = 'https://api.deepgram.com/v1/listen'

/**
 * Nova-2, Russian — the fast path, and what every MediQaz consultation has used
 * so far. Deliberately frozen: adding other languages must not be able to
 * change what Russian-speaking doctors already get.
 *
 * Nova-2 has no Kazakh whatsoever — `kk` is absent from its language list — so
 * a `language=kk` request here would not degrade gracefully, it would return
 * confident Russian nonsense. Keeping that request from ever being made is the
 * transcription router's job, not this adapter's.
 */
export const NOVA2_STREAM_PARAMS: Readonly<Record<string, string>> = Object.freeze({
  model: 'nova-2',
  language: 'ru',
  smart_format: 'true',
  diarize: 'true',
  punctuate: 'true',
  interim_results: 'true',
  utterance_end_ms: '1000',
})

const queryParams = new URLSearchParams({
  model: 'nova-2',
  language: 'ru',
  smart_format: 'true',
  diarize: 'true',
  punctuate: 'true',
}).toString()

export function createDeepgramNova2Transcriber({
  apiKey,
  fetchImpl = fetch,
  // Processing a full recording takes longer than the short grant request;
  // this covers a long consultation without leaving the doctor waiting forever.
  timeoutMs = 120_000,
}: {
  apiKey: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}): AudioTranscriber {
  return {
    async transcribe({ audio, contentType }): Promise<AudioTranscription> {
      const startedAt = Date.now()
      const response = await fetchImpl(`${listenEndpoint}?${queryParams}`, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': contentType,
        },
        // A plain Uint8Array is ambiguous across the DOM/bun/undici BodyInit
        // typings this project pulls in; Blob is the one variant all three agree on.
        body: new Blob([audio]),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        throw new Error(`Deepgram transcription failed with status ${response.status}`)
      }

      // Shared with the Whisper adapter. Russian is the language most
      // consultations are recorded in, so a silent visit here has to produce
      // the same "no speech recognized" answer it produces for Kazakh — not a
      // generic provider failure telling the doctor to try again.
      return readDeepgramTranscription(response, {
        model: 'nova-2',
        language: 'ru',
        startedAt,
        tag: 'nova2',
      })
    },
  }
}
