import { expect, test } from 'bun:test'

import { transcriptionLanguageSchema, type TranscriptionLanguage } from '@mediqaz/contracts'

import { createDeepgramTranscriptionRouter } from './transcription-router'

function routerRecordingRequests() {
  const urls: string[] = []
  const router = createDeepgramTranscriptionRouter({
    apiKey: 'key',
    fetchImpl: async (input) => {
      urls.push(input)
      return new Response(
        JSON.stringify({
          metadata: { duration: 12 },
          results: { channels: [{ alternatives: [{ transcript: 'приём' }] }] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    },
  })
  return { router, urls }
}

async function transcribeIn(language: TranscriptionLanguage) {
  const { router, urls } = routerRecordingRequests()
  await router.batchTranscriberFor(language).transcribe({
    audio: new Uint8Array([1, 2, 3]),
    contentType: 'audio/mp4',
  })
  return new URL(urls[0] ?? '').searchParams
}

test('Kazakh never reaches Nova-2, which has no Kazakh at all', async () => {
  const params = await transcribeIn('kk')

  // The whole point of the router. Nova-2's language list has no `kk`, so this
  // pairing does not degrade — it returns confident Russian nonsense, which a
  // doctor would have to catch by reading the med card.
  expect(params.get('model')).not.toBe('nova-2')
  expect(params.get('model')).toContain('whisper')
  expect(params.get('language')).toBe('kk')
})

test('Russian still goes to Nova-2 with the parameters it always used', async () => {
  const params = await transcribeIn('ru')

  expect(params.get('model')).toBe('nova-2')
  expect(params.get('language')).toBe('ru')
  expect(params.get('smart_format')).toBe('true')
  expect(params.get('diarize')).toBe('true')
  expect(params.get('punctuate')).toBe('true')
})

test('auto-detect asks the provider to detect rather than naming a language', async () => {
  const params = await transcribeIn('multi')

  expect(params.get('detect_language')).toBe('true')
  expect(params.get('language')).toBeNull()
  expect(params.get('model')).toContain('whisper')
})

test('only Russian has a streaming provider; the rest answer null, not a guess', () => {
  const { router } = routerRecordingRequests()

  expect(router.streamingParamsFor('ru')).toMatchObject({
    model: 'nova-2',
    language: 'ru',
    interim_results: 'true',
  })
  // No Deepgram model streams Kazakh: Nova-2 and Nova-3 lack the language, and
  // Whisper, which has it, is pre-recorded only. Null is the honest answer.
  expect(router.streamingParamsFor('kk')).toBeNull()
  expect(router.streamingParamsFor('multi')).toBeNull()
})

test('every language in the contract has a batch provider', () => {
  const { router } = routerRecordingRequests()

  // A language added to the contract without a row here would otherwise only
  // surface as a runtime failure on a doctor's first recording.
  for (const language of transcriptionLanguageSchema.options) {
    expect(() => router.batchTranscriberFor(language)).not.toThrow()
  }
})

test('streaming parameters cannot be mutated by a caller', () => {
  const { router } = routerRecordingRequests()

  const params = router.streamingParamsFor('ru')
  params!.language = 'kk'

  expect(router.streamingParamsFor('ru')?.language).toBe('ru')
})
