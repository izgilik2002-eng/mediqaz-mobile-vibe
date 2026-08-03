import { expect, test } from 'bun:test'

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

test('rejects a success response that carries no transcript', async () => {
  const transcriber = createDeepgramNova2Transcriber({
    apiKey: 'k',
    fetchImpl: async () => jsonResponse({ results: { channels: [{ alternatives: [{ transcript: '' }] }] } }),
  })

  await expect(
    transcriber.transcribe({ audio: new Uint8Array(), contentType: 'audio/mp4' }),
  ).rejects.toThrow('no transcript')
})
