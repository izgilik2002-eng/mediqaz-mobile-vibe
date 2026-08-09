import { expect, test } from 'bun:test'

import { transcriptionLanguageSchema, type TranscriptionLanguage } from '@mediqaz/contracts'

import { createTranscriptionRouter } from './transcription-router'

type RecordedRequest = { url: string; init: RequestInit }

function routerRecordingRequests() {
  const requests: RecordedRequest[] = []
  const router = createTranscriptionRouter({
    deepgramApiKey: 'deepgram-key',
    openAiApiKey: 'openai-key',
    fetchImpl: async (url, init) => {
      requests.push({ url, init })

      // Both providers are answered with their own success shape, so a request
      // routed to the wrong one fails loudly here instead of resolving.
      const body = url.startsWith('https://api.openai.com/')
        ? { text: 'приём' }
        : {
            metadata: { duration: 12 },
            results: { channels: [{ alternatives: [{ transcript: 'приём' }] }] },
          }

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
  return { router, requests }
}

async function transcribeIn(language: TranscriptionLanguage) {
  const { router, requests } = routerRecordingRequests()
  await router.batchTranscriberFor(language).transcribe({
    audio: new Uint8Array([1, 2, 3]),
    contentType: 'audio/mp4',
  })

  const request = requests[0]!
  return {
    url: request.url,
    params: new URL(request.url).searchParams,
    form: request.init.body instanceof FormData ? request.init.body : null,
    authorization: new Headers(request.init.headers).get('Authorization'),
  }
}

test('Kazakh never reaches Nova-2, which has no Kazakh at all', async () => {
  const { url, form } = await transcribeIn('kk')

  // The whole point of the router. Nova-2's language list has no `kk`, so that
  // pairing does not degrade — it returns confident Russian nonsense, which a
  // doctor would have to catch by reading the med card.
  expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
  expect(form?.get('model')).toBe('gpt-4o-transcribe')
  expect(form?.get('language')).toBe('kk')
})

test('Kazakh no longer reaches Deepgram at all, on either key or model', async () => {
  const { url, authorization } = await transcribeIn('kk')

  // Deepgram Whisper knew Kazakh but kept transcribing it as Russian, which is
  // why this language moved. Sending it back there — or sending the Deepgram
  // key to OpenAI — is the regression this guards.
  expect(url).not.toContain('deepgram.com')
  expect(authorization).toBe('Bearer openai-key')
  expect(authorization).not.toContain('deepgram-key')
})

test('Russian still goes to Nova-2 with the parameters it always used', async () => {
  const { url, params, authorization } = await transcribeIn('ru')

  // Frozen on purpose: every consultation recorded so far has been Russian,
  // and moving Kazakh must not be able to change what those doctors get.
  expect(url).toContain('api.deepgram.com')
  expect(params.get('model')).toBe('nova-2')
  expect(params.get('language')).toBe('ru')
  expect(params.get('smart_format')).toBe('true')
  expect(params.get('diarize')).toBe('true')
  expect(params.get('punctuate')).toBe('true')
  expect(authorization).toBe('Token deepgram-key')
})

test('auto-detect asks the provider to detect rather than naming a language', async () => {
  const { url, form } = await transcribeIn('multi')

  expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
  expect(form?.get('model')).toBe('gpt-4o-transcribe')
  expect(form?.get('language')).toBeNull()
})

test('the model override reaches the Kazakh provider and not the Russian one', async () => {
  const requests: RecordedRequest[] = []
  const router = createTranscriptionRouter({
    deepgramApiKey: 'deepgram-key',
    openAiApiKey: 'openai-key',
    openAiModel: 'whisper-1',
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      const body = url.startsWith('https://api.openai.com/')
        ? { text: 'приём' }
        : {
            metadata: { duration: 12 },
            results: { channels: [{ alternatives: [{ transcript: 'приём' }] }] },
          }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })

  const audio = { audio: new Uint8Array([1, 2, 3]), contentType: 'audio/mp4' }
  await router.batchTranscriberFor('kk').transcribe(audio)
  await router.batchTranscriberFor('ru').transcribe(audio)

  // One env variable, one language pair. The lever that let today's Kazakh
  // model be changed without a deploy must not be able to touch Russian.
  expect((requests[0]!.init.body as FormData).get('model')).toBe('whisper-1')
  expect(new URL(requests[1]!.url).searchParams.get('model')).toBe('nova-2')
})

test('only Russian has a streaming provider; the rest answer null, not a guess', () => {
  const { router } = routerRecordingRequests()

  expect(router.streamingParamsFor('ru')).toMatchObject({
    model: 'nova-2',
    language: 'ru',
    interim_results: 'true',
  })
  // Nothing streams Kazakh for this product: Nova-2 and Nova-3 lack the
  // language, Deepgram's Whisper is pre-recorded only, and OpenAI's
  // transcription models are not reachable over the socket protocol the client
  // speaks. Null is the honest answer.
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
