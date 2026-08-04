import { expect, test } from 'bun:test'

import { RecordingTooLongError, TranscriptionTimedOutError } from '../domain/errors'
import { createDeepgramWhisperTranscriber } from './deepgram-whisper'

const audio = { audio: new Uint8Array([1, 2, 3]), contentType: 'audio/mp4' }

function okResponse(durationSeconds: number) {
  return new Response(
    JSON.stringify({
      metadata: { duration: durationSeconds },
      results: { channels: [{ alternatives: [{ transcript: 'приём' }] }] },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

test('our own timeout is a slow provider, not an over-long recording', async () => {
  const transcriber = createDeepgramWhisperTranscriber({
    apiKey: 'key',
    language: 'kk',
    fetchImpl: async () => {
      // What AbortSignal.timeout produces when the budget runs out.
      const error = new Error('The operation timed out.')
      error.name = 'TimeoutError'
      throw error
    },
  })

  // The distinction that matters: measured latency on this provider swings
  // from one second to over three minutes for identical input, so a timeout
  // carries no information about the recording at all.
  await expect(transcriber.transcribe(audio)).rejects.toBeInstanceOf(TranscriptionTimedOutError)
  await expect(transcriber.transcribe(audio)).rejects.not.toBeInstanceOf(RecordingTooLongError)
})

test("the provider's own 504 does mean the recording was too long", async () => {
  const transcriber = createDeepgramWhisperTranscriber({
    apiKey: 'key',
    language: 'kk',
    maxAudioSeconds: 600,
    fetchImpl: async () => new Response(null, { status: 504 }),
  })

  await expect(transcriber.transcribe(audio)).rejects.toBeInstanceOf(RecordingTooLongError)
})

test('a recording past the configured cap is refused even when the provider accepted it', async () => {
  const transcriber = createDeepgramWhisperTranscriber({
    apiKey: 'key',
    language: 'kk',
    maxAudioSeconds: 600,
    fetchImpl: async () => okResponse(900),
  })

  await expect(transcriber.transcribe(audio)).rejects.toBeInstanceOf(RecordingTooLongError)
})

test('a recording inside the cap comes back with its measured duration', async () => {
  const transcriber = createDeepgramWhisperTranscriber({
    apiKey: 'key',
    language: 'kk',
    maxAudioSeconds: 600,
    fetchImpl: async () => okResponse(90),
  })

  // The 90-second case from the bug report: nothing about it is too long.
  await expect(transcriber.transcribe(audio)).resolves.toEqual({
    transcript: 'приём',
    durationSeconds: 90,
  })
})

test('auto-detect asks the provider to detect instead of naming a language', async () => {
  const urls: string[] = []
  const transcriber = createDeepgramWhisperTranscriber({
    apiKey: 'key',
    language: null,
    fetchImpl: async (url) => {
      urls.push(url)
      return okResponse(10)
    },
  })

  await transcriber.transcribe(audio)

  const params = new URL(urls[0] ?? '').searchParams
  expect(params.get('detect_language')).toBe('true')
  expect(params.get('language')).toBeNull()
})

test('a rejected request is not mistaken for either a timeout or a long recording', async () => {
  const transcriber = createDeepgramWhisperTranscriber({
    apiKey: 'key',
    language: 'kk',
    fetchImpl: async () => new Response('bad model', { status: 400 }),
  })

  const failure = transcriber.transcribe(audio)
  await expect(failure).rejects.toThrow('status 400')
  await expect(failure).rejects.not.toBeInstanceOf(RecordingTooLongError)
  await expect(failure).rejects.not.toBeInstanceOf(TranscriptionTimedOutError)
})
