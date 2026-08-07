import { expect, test } from 'bun:test'

import {
  RecordingTooLongError,
  SpeechNotRecognizedError,
  TranscriptionTimedOutError,
} from '../domain/errors'
import { DeepgramResponseError } from './deepgram-response'
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

/** Redirects console output into `sink`; returns the restore function. */
function captureConsole(sink: string[]) {
  const realLog = console.log
  const realError = console.error
  const capture = (...args: unknown[]) => {
    sink.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }
  console.log = capture
  console.error = capture
  return () => {
    console.log = realLog
    console.error = realError
  }
}

function bodyResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function transcriberReturning(body: unknown) {
  return createDeepgramWhisperTranscriber({
    apiKey: 'key',
    language: 'kk',
    fetchImpl: async () => bodyResponse(body),
  })
}

test('an empty alternatives array is "no speech recognized", not a generic failure', async () => {
  // The exact shape observed live from Deepgram Whisper on silence:
  // `"alternatives": []`, a well-formed body carrying nothing.
  const failure = transcriberReturning({
    metadata: { duration: 3 },
    results: { channels: [{ alternatives: [] }] },
  }).transcribe(audio)

  await expect(failure).rejects.toBeInstanceOf(SpeechNotRecognizedError)
  await expect(failure).rejects.not.toBeInstanceOf(RecordingTooLongError)
  await expect(failure).rejects.not.toBeInstanceOf(TranscriptionTimedOutError)
})

test('a blank transcript inside a well-formed alternative is also no speech recognized', async () => {
  const failure = transcriberReturning({
    metadata: { duration: 3 },
    results: { channels: [{ alternatives: [{ transcript: '   ' }] }] },
  }).transcribe(audio)

  await expect(failure).rejects.toBeInstanceOf(SpeechNotRecognizedError)
})

// The boundary this file exists to defend. Each of these is a provider
// contract problem, not a silent recording: classifying any of them as "no
// speech" would tell the doctor to re-record audio that was never at fault and
// would demote a real outage from 5xx to 4xx, silencing alerting.
const MALFORMED_BODIES: Array<{ label: string; body: unknown }> = [
  { label: 'no results key at all', body: { metadata: { duration: 3 } } },
  { label: 'results present but no channels', body: { results: {} } },
  { label: 'channels is an empty array', body: { results: { channels: [] } } },
  {
    label: 'channel present but alternatives missing',
    body: { results: { channels: [{}] } },
  },
  {
    label: 'alternatives renamed upstream',
    body: { results: { channels: [{ alternatives: null }] } },
  },
  {
    label: 'transcript field renamed upstream',
    body: { results: { channels: [{ alternatives: [{ text: 'приём' }] }] } },
  },
  {
    label: '200 error envelope from a proxy',
    body: { err_code: 'INTERNAL', err_msg: 'upstream exploded' },
  },
]

for (const { label, body } of MALFORMED_BODIES) {
  test(`a structurally unexpected 200 is not reported as no speech: ${label}`, async () => {
    const failure = transcriberReturning(body).transcribe(audio)

    // The assertion that matters: this must reach the generic transcription
    // failure the service maps to 502, never the 422 "your recording was
    // silent" answer.
    await expect(failure).rejects.toBeInstanceOf(DeepgramResponseError)
    await expect(failure).rejects.not.toBeInstanceOf(SpeechNotRecognizedError)
    await expect(failure).rejects.not.toBeInstanceOf(RecordingTooLongError)
    await expect(failure).rejects.not.toBeInstanceOf(TranscriptionTimedOutError)
  })
}

test('no consultation speech reaches the logs, in any field of the response', async () => {
  const written: string[] = []
  const restore = captureConsole(written)

  const transcript = 'Пациент жалуется на боль в груди'
  try {
    // A diarized body, which is what our own query asks for: the same speech
    // is repeated in `words[]` and `paragraphs[]`, not only in `transcript`.
    // Logging the body — even with `transcript` masked — would leak all of it.
    await transcriberReturning({
      metadata: { duration: 12 },
      results: {
        channels: [
          {
            detected_language: 'ru',
            alternatives: [
              {
                transcript,
                words: [{ word: 'стенокардия', punctuated_word: 'Стенокардия', speaker: 0 }],
                paragraphs: { paragraphs: [{ sentences: [{ text: 'Диагноз стенокардия' }] }] },
              },
            ],
          },
        ],
      },
    }).transcribe(audio)
  } finally {
    restore()
  }

  const logged = written.join('\n')
  for (const word of ['Пациент', 'боль', 'груди', 'стенокардия', 'Стенокардия', 'Диагноз']) {
    expect(logged, `"${word}" reached the logs`).not.toContain(word)
  }
  // Assert the derived values, not merely that the keys exist: both keys are
  // always present with fallbacks, so checking for the key alone would pass
  // even if the values stopped resolving.
  expect(logged).toContain('"detectedLanguage":"ru"')
  expect(logged).toContain(`"transcriptLength":${transcript.length}`)
})

test('a detected_language that is not a language tag is never printed', async () => {
  const written: string[] = []
  const restore = captureConsole(written)

  // `detected_language` is the one provider-controlled string this adapter
  // echoes into a log line, and it arrives typed `unknown`. If the provider
  // ever put free text there, printing it verbatim would put consultation
  // speech in the logs through the one field the leak test above cannot see.
  try {
    await transcriberReturning({
      metadata: { duration: 12 },
      results: {
        channels: [
          {
            detected_language: 'ПАЦИЕНТ ЖАЛУЕТСЯ НА БОЛЬ В ГРУДИ',
            alternatives: [{ transcript: 'приём' }],
          },
        ],
      },
    }).transcribe(audio)
  } finally {
    restore()
  }

  const logged = written.join('\n')
  expect(logged).not.toContain('ПАЦИЕНТ')
  expect(logged).not.toContain('ГРУДИ')
  expect(logged).toContain('"detectedLanguage":"(unexpected)"')
})

test('a well-formed language tag still reaches the logs, since kk-vs-ru is the reason it is there', async () => {
  const written: string[] = []
  const restore = captureConsole(written)

  try {
    await transcriberReturning({
      metadata: { duration: 12 },
      results: {
        channels: [{ detected_language: 'kk', alternatives: [{ transcript: 'приём' }] }],
      },
    }).transcribe(audio)
  } finally {
    restore()
  }

  expect(written.join('\n')).toContain('"detectedLanguage":"kk"')
})

test('a non-JSON 200 is a named provider fault, and it is logged rather than silent', async () => {
  const written: string[] = []
  const restore = captureConsole(written)

  const gateway = '<html><body>gateway timeout</body></html>'
  try {
    const failure = createDeepgramWhisperTranscriber({
      apiKey: 'key',
      language: 'kk',
      fetchImpl: async () =>
        new Response(gateway, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    }).transcribe(audio)

    await expect(failure).rejects.toBeInstanceOf(DeepgramResponseError)
    await expect(failure).rejects.toThrow('body was not JSON')
    await expect(failure).rejects.not.toBeInstanceOf(SpeechNotRecognizedError)
  } finally {
    restore()
  }

  // Before this was handled, `response.json()` threw above every log line in
  // the adapter, so the whole path produced no trace at all and the doctor's
  // error message was the only evidence an engineer had.
  const logged = written.join('\n')
  expect(logged).toContain('was not JSON')
  expect(logged).toContain('"contentType":"text/html"')
  expect(logged).toContain(`"bodyLength":${gateway.length}`)
  // The body itself is diagnostic noise at best and untrusted content at
  // worst; only its size is worth recording.
  expect(logged).not.toContain('gateway timeout')
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
