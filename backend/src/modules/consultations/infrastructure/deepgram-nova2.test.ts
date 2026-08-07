import { expect, test } from 'bun:test'

import { SpeechNotRecognizedError } from '../domain/errors'
import { DeepgramResponseError } from './deepgram-response'
import { createDeepgramNova2Transcriber } from './deepgram-nova2'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const prerecordedBody = (transcript: string, duration = 42.4) => ({
  metadata: { duration },
  results: { channels: [{ alternatives: [{ transcript }] }] },
})

test('sends the recording bytes with the long-lived key and matching content type', async () => {
  const calls: Array<{ url: string; authorization: string | null; contentType: string | null; body: unknown }> = []
  const transcriber = createDeepgramNova2Transcriber({
    apiKey: 'long-lived-key',
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        authorization: new Headers(init?.headers).get('Authorization'),
        contentType: new Headers(init?.headers).get('Content-Type'),
        body: init?.body,
      })
      return jsonResponse(prerecordedBody('доктор: на что жалуетесь'))
    },
  })

  const audio = new Uint8Array([1, 2, 3])
  await expect(
    transcriber.transcribe({ audio, contentType: 'audio/mp4' }),
  ).resolves.toEqual({ transcript: 'доктор: на что жалуетесь', durationSeconds: 42 })

  expect(calls[0]?.url).toContain('https://api.deepgram.com/v1/listen?')
  expect(calls[0]?.authorization).toBe('Token long-lived-key')
  expect(calls[0]?.contentType).toBe('audio/mp4')
  expect(calls[0]?.body).toBeInstanceOf(Blob)
  expect(new Uint8Array(await (calls[0]?.body as Blob).arrayBuffer())).toEqual(audio)
})

test('falls back to zero duration when the provider omits metadata', async () => {
  const transcriber = createDeepgramNova2Transcriber({
    apiKey: 'k',
    fetchImpl: async () => jsonResponse({ results: { channels: [{ alternatives: [{ transcript: 'приём' }] }] } }),
  })

  await expect(
    transcriber.transcribe({ audio: new Uint8Array(), contentType: 'audio/mp4' }),
  ).resolves.toEqual({ transcript: 'приём', durationSeconds: 0 })
})

test('rejects a provider error instead of returning an empty transcript', async () => {
  const transcriber = createDeepgramNova2Transcriber({
    apiKey: 'k',
    fetchImpl: async () => jsonResponse({ error: 'unsupported media' }, 400),
  })

  await expect(
    transcriber.transcribe({ audio: new Uint8Array(), contentType: 'audio/mp4' }),
  ).rejects.toThrow('status 400')
})

test('a silent Russian recording gets the same "no speech" answer as Kazakh does', async () => {
  // Nova-2's shape for silence, observed live: one alternative holding an
  // empty string. Russian is the language most consultations are recorded in,
  // so this must not fall through to the generic provider failure that tells
  // the doctor to send the same silent file again.
  const transcriber = createDeepgramNova2Transcriber({
    apiKey: 'k',
    fetchImpl: async () =>
      jsonResponse({ results: { channels: [{ alternatives: [{ transcript: '' }] }] } }),
  })

  const failure = transcriber.transcribe({ audio: new Uint8Array(), contentType: 'audio/mp4' })
  await expect(failure).rejects.toBeInstanceOf(SpeechNotRecognizedError)
  await expect(failure).rejects.not.toBeInstanceOf(DeepgramResponseError)
})

test('a structurally unexpected 200 stays a provider fault for Russian too', async () => {
  const transcriber = createDeepgramNova2Transcriber({
    apiKey: 'k',
    fetchImpl: async () => jsonResponse({ results: { channels: [{ alternatives: null }] } }),
  })

  const failure = transcriber.transcribe({ audio: new Uint8Array(), contentType: 'audio/mp4' })
  await expect(failure).rejects.toBeInstanceOf(DeepgramResponseError)
  await expect(failure).rejects.not.toBeInstanceOf(SpeechNotRecognizedError)
})
