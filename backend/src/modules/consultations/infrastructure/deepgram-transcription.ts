import { TRANSCRIPTION_PARAMS } from '@mediqaz/contracts'

import type { AudioTranscriber, AudioTranscription, FetchLike } from '../application/ports'

const listenEndpoint = 'https://api.deepgram.com/v1/listen'

const queryParams = new URLSearchParams({
  model: TRANSCRIPTION_PARAMS.model,
  language: TRANSCRIPTION_PARAMS.language,
  smart_format: TRANSCRIPTION_PARAMS.smart_format,
  diarize: TRANSCRIPTION_PARAMS.diarize,
  punctuate: TRANSCRIPTION_PARAMS.punctuate,
}).toString()

type DeepgramPrerecordedResponse = {
  metadata?: { duration?: unknown }
  results?: {
    channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }>
  }
}

export function createDeepgramAudioTranscriber({
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

      const payload = (await response.json()) as DeepgramPrerecordedResponse
      const transcript = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript

      if (typeof transcript !== 'string' || transcript.trim() === '') {
        throw new Error('Deepgram transcription response contained no transcript')
      }

      const duration = payload.metadata?.duration
      const durationSeconds =
        typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
          ? Math.round(duration)
          : 0

      return { transcript, durationSeconds }
    },
  }
}
