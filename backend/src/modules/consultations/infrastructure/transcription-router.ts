import type { TranscriptionLanguage } from '@mediqaz/contracts'

import { ConsultationFailure } from '../domain/errors'
import type { AudioTranscriber, FetchLike, TranscriptionRouter } from '../application/ports'
import { createDeepgramNova2Transcriber, NOVA2_STREAM_PARAMS } from './deepgram-nova2'
import { createOpenAiTranscriber } from './openai-transcribe'

/**
 * Turns the doctor's language into a provider. This is the only file in the
 * codebase that knows both halves — every layer above speaks
 * `TranscriptionLanguage` and nothing else, so moving a language to a different
 * model is a new adapter plus a row in the table below.
 *
 * Two providers, split by language and not by preference:
 *
 * - Russian stays on Deepgram Nova-2, streaming, untouched. It is what every
 *   MediQaz consultation has used and it works; a change made for Kazakh must
 *   not be able to reach it.
 * - Kazakh and auto-detect run on OpenAI. Deepgram has exactly one model that
 *   knows Kazakh at all — hosted Whisper — and it kept returning Russian for
 *   Kazakh speech.
 * - Only Russian has a streaming model. Nova-2 has no Kazakh, Nova-3's
 *   multilingual set has no Kazakh, and neither OpenAI transcription model is
 *   reachable over the socket protocol the client speaks. `streamingParamsFor`
 *   therefore returns `null` for Kazakh and auto-detect, and callers are
 *   expected to say so out loud rather than open a socket that silently
 *   transcribes nothing.
 * - Batch and streaming capability differ per language, so they are two
 *   separate questions. Answering them together would force a language with one
 *   and not the other into a lie.
 */
export function createTranscriptionRouter({
  deepgramApiKey,
  openAiApiKey,
  openAiModel,
  maxAudioSeconds,
  fetchImpl,
}: {
  deepgramApiKey: string
  openAiApiKey: string
  openAiModel?: string
  maxAudioSeconds?: number
  fetchImpl?: FetchLike
}): TranscriptionRouter {
  const nova2 = () => createDeepgramNova2Transcriber({ apiKey: deepgramApiKey, fetchImpl })

  /**
   * The Kazakh and auto-detect provider, named for the job rather than the
   * vendor. `deepgram-whisper.ts` and its tests stay in the tree precisely so
   * that rolling back is this one expression: both adapters take the same
   * `{ apiKey, language, model, maxAudioSeconds, fetchImpl }` shape, so the
   * revert is the factory name and the key it reads.
   */
  const kazakh = (language: string | null) =>
    createOpenAiTranscriber({
      apiKey: openAiApiKey,
      language,
      model: openAiModel,
      maxAudioSeconds,
      fetchImpl,
    })

  // Built once: the adapters are stateless, and constructing them per request
  // would only rebuild the same request template.
  const batch: Record<TranscriptionLanguage, AudioTranscriber> = {
    ru: nova2(),
    kk: kazakh('kk'),
    // Auto-detect rather than a fixed code: the doctor chose "whichever
    // language this visit turns out to be".
    multi: kazakh(null),
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
