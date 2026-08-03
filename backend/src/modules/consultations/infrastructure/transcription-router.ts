import type { TranscriptionLanguage } from '@mediqaz/contracts'

import { ConsultationFailure } from '../domain/errors'
import type { AudioTranscriber, FetchLike, TranscriptionRouter } from '../application/ports'
import { createDeepgramNova2Transcriber, NOVA2_STREAM_PARAMS } from './deepgram-nova2'
import { createDeepgramWhisperTranscriber } from './deepgram-whisper'

/**
 * Turns the doctor's language into a provider. This is the only file in the
 * codebase that knows both halves — every layer above speaks
 * `TranscriptionLanguage` and nothing else, so moving Kazakh to ISSAI or a
 * self-hosted model later is a new adapter plus a row in the table below.
 *
 * Two properties of the current provider drive the shape:
 *
 * - Only Russian has a streaming model. Nova-2 has no Kazakh, Nova-3's
 *   multilingual set has no Kazakh, and Whisper — which does — cannot stream at
 *   all. `streamingParamsFor` therefore returns `null` for Kazakh and
 *   auto-detect, and callers are expected to say so out loud rather than open a
 *   socket that silently transcribes nothing.
 * - Batch and streaming capability differ per language, so they are two
 *   separate questions. Answering them together would force a language with one
 *   and not the other into a lie.
 */
export function createDeepgramTranscriptionRouter({
  apiKey,
  whisperModel,
  maxAudioSeconds,
  fetchImpl,
}: {
  apiKey: string
  whisperModel?: string
  maxAudioSeconds?: number
  fetchImpl?: FetchLike
}): TranscriptionRouter {
  const nova2 = () => createDeepgramNova2Transcriber({ apiKey, fetchImpl })
  const whisper = (language: string | null) =>
    createDeepgramWhisperTranscriber({
      apiKey,
      language,
      model: whisperModel,
      maxAudioSeconds,
      fetchImpl,
    })

  // Built once: the adapters are stateless, and constructing them per request
  // would only re-parse the same query string.
  const batch: Record<TranscriptionLanguage, AudioTranscriber> = {
    ru: nova2(),
    kk: whisper('kk'),
    // Auto-detect rather than a fixed code: the doctor chose "whichever
    // language this visit turns out to be".
    multi: whisper(null),
  }

  const streaming: Record<TranscriptionLanguage, Record<string, string> | null> = {
    ru: { ...NOVA2_STREAM_PARAMS },
    kk: null,
    multi: null,
  }

  return {
    batchTranscriberFor(language) {
      const transcriber = batch[language]
      if (!transcriber) {
        throw new ConsultationFailure(
          'transcription_unavailable',
          `No transcription provider is configured for ${language}`,
        )
      }
      return transcriber
    },

    streamingParamsFor(language) {
      const params = streaming[language]
      return params ? { ...params } : null
    },
  }
}
