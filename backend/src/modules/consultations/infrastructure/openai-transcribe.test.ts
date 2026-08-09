import { expect, test } from 'bun:test'

import {
  RecordingTooLongError,
  SpeechNotRecognizedError,
  TranscriptionTimedOutError,
} from '../domain/errors'
import { createOpenAiTranscriber, OpenAiResponseError } from './openai-transcribe'

const audio = { audio: new Uint8Array([1, 2, 3]), contentType: 'audio/mp4' }

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function transcriberReturning(body: unknown) {
  return createOpenAiTranscriber({
    apiKey: 'key',
    language: 'kk',
    fetchImpl: async () => jsonResponse(body),
  })
}

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

test('a transcribed recording comes back on the same contract the Deepgram adapters return', async () => {
  // The reason this adapter can be swapped in under the router without the
  // service noticing: same shape, same keys, same types.
  await expect(transcriberReturning({ text: 'приём' }).transcribe(audio)).resolves.toEqual({
    transcript: 'приём',
    durationSeconds: 0,
  })
})

test('a duration-billed model has its measured length carried through', async () => {
  // `gpt-4o-transcribe` bills by token and reports no length at all, so the
  // zero above is the normal case. Whisper-1 — reachable through the model
  // override — bills by duration and does report it; taking it when offered is
  // what keeps the stored consultation length honest instead of always 0.
  await expect(
    transcriberReturning({ text: 'приём', usage: { type: 'duration', seconds: 90.4 } }).transcribe(
      audio,
    ),
  ).resolves.toEqual({ transcript: 'приём', durationSeconds: 90 })
})

test('an empty transcript is "no speech recognized", not a generic failure', async () => {
  // OpenAI's answer to silence is a 200 carrying `{"text": ""}` — the
  // structural equivalent of Deepgram Whisper's `"alternatives": []`. Both mean
  // the recording had nothing in it, and the doctor needs to hear that rather
  // than "try again", which would fail identically forever.
  const failure = transcriberReturning({ text: '' }).transcribe(audio)

  await expect(failure).rejects.toBeInstanceOf(SpeechNotRecognizedError)
  await expect(failure).rejects.not.toBeInstanceOf(RecordingTooLongError)
  await expect(failure).rejects.not.toBeInstanceOf(TranscriptionTimedOutError)
  await expect(failure).rejects.not.toBeInstanceOf(OpenAiResponseError)
})

test('a whitespace-only transcript is also no speech recognized', async () => {
  await expect(
    transcriberReturning({ text: '   \n  ' }).transcribe(audio),
  ).rejects.toBeInstanceOf(SpeechNotRecognizedError)
})

test('our own timeout is a slow provider, not an over-long recording', async () => {
  const transcriber = createOpenAiTranscriber({
    apiKey: 'key',
    language: 'kk',
    fetchImpl: async () => {
      // What AbortSignal.timeout produces when the budget runs out.
      const error = new Error('The operation timed out.')
      error.name = 'TimeoutError'
      throw error
    },
  })

  await expect(transcriber.transcribe(audio)).rejects.toBeInstanceOf(TranscriptionTimedOutError)
  await expect(transcriber.transcribe(audio)).rejects.not.toBeInstanceOf(RecordingTooLongError)
})

test("the provider's own 413 does mean the recording was too big to accept", async () => {
  // OpenAI refuses anything past 25MB with a 413. Unlike our timeout, that is
  // a property of the file, so it earns the answer that tells the doctor to
  // record a shorter visit.
  const transcriber = createOpenAiTranscriber({
    apiKey: 'key',
    language: 'kk',
    maxAudioSeconds: 600,
    fetchImpl: async () => new Response(null, { status: 413 }),
  })

  await expect(transcriber.transcribe(audio)).rejects.toBeInstanceOf(RecordingTooLongError)
})

test('a reported length past the configured cap is refused even when the provider accepted it', async () => {
  const transcriber = createOpenAiTranscriber({
    apiKey: 'key',
    language: 'kk',
    maxAudioSeconds: 600,
    fetchImpl: async () =>
      jsonResponse({ text: 'приём', usage: { type: 'duration', seconds: 900 } }),
  })

  await expect(transcriber.transcribe(audio)).rejects.toBeInstanceOf(RecordingTooLongError)
})

// The boundary this file exists to defend, mirroring the Deepgram adapters:
// each of these is a provider contract problem, not a silent recording.
// Classifying any of them as "no speech" would tell the doctor to re-record
// audio that was never at fault and would demote a real outage from 5xx to
// 4xx, where alerting cannot see it.
const MALFORMED_BODIES: Array<{ label: string; body: unknown }> = [
  { label: 'no text key at all', body: { usage: { type: 'tokens', input_tokens: 14 } } },
  { label: 'text renamed upstream', body: { transcript: 'приём' } },
  { label: 'text arrived as a structured object', body: { text: { value: 'приём' } } },
  { label: 'text arrived as null', body: { text: null } },
  { label: '200 error envelope from a proxy', body: { error: { message: 'upstream exploded' } } },
]

for (const { label, body } of MALFORMED_BODIES) {
  test(`a structurally unexpected 200 is not reported as no speech: ${label}`, async () => {
    const failure = transcriberReturning(body).transcribe(audio)

    await expect(failure).rejects.toBeInstanceOf(OpenAiResponseError)
    await expect(failure).rejects.not.toBeInstanceOf(SpeechNotRecognizedError)
    await expect(failure).rejects.not.toBeInstanceOf(RecordingTooLongError)
    await expect(failure).rejects.not.toBeInstanceOf(TranscriptionTimedOutError)
  })
}

test('a non-JSON 200 is a named provider fault, and it is logged rather than silent', async () => {
  const written: string[] = []
  const restore = captureConsole(written)

  const gateway = '<html><body>gateway timeout</body></html>'
  try {
    const failure = createOpenAiTranscriber({
      apiKey: 'key',
      language: 'kk',
      fetchImpl: async () =>
        new Response(gateway, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    }).transcribe(audio)

    await expect(failure).rejects.toBeInstanceOf(OpenAiResponseError)
    await expect(failure).rejects.toThrow('body was not JSON')
    await expect(failure).rejects.not.toBeInstanceOf(SpeechNotRecognizedError)
  } finally {
    restore()
  }

  const logged = written.join('\n')
  expect(logged).toContain('was not JSON')
  expect(logged).toContain('"contentType":"text/html"')
  expect(logged).toContain(`"bodyLength":${gateway.length}`)
  // The body itself is diagnostic noise at best and untrusted content at
  // worst; only its size is worth recording.
  expect(logged).not.toContain('gateway timeout')
})

test('no consultation speech reaches the logs, in any field of the response', async () => {
  const written: string[] = []
  const restore = captureConsole(written)

  const text = 'Пациент жалуется на боль в груди'
  const apiKey = 'sk-proj-never-log-this-credential'
  try {
    // Everything OpenAI can attach to a transcription alongside `text`:
    // per-token log probabilities and segments both repeat the same speech.
    // Logging the body — even with `text` masked — would leak all of it.
    await createOpenAiTranscriber({
      apiKey,
      language: 'kk',
      fetchImpl: async () =>
        jsonResponse({
          text,
          language: 'ru',
          logprobs: [
            { token: 'стенокардия', logprob: -0.1 },
            { token: 'Диагноз', logprob: -0.2 },
          ],
          segments: [{ id: 0, text: 'Диагноз стенокардия' }],
          usage: { type: 'tokens', input_tokens: 14, output_tokens: 45 },
        }),
    }).transcribe(audio)
  } finally {
    restore()
  }

  const logged = written.join('\n')
  for (const word of ['Пациент', 'боль', 'груди', 'стенокардия', 'Диагноз']) {
    expect(logged, `"${word}" reached the logs`).not.toContain(word)
  }
  // The API key travels in a header this adapter builds, and a log line that
  // dumped the request would carry it. Keys leaking through screenshots is a
  // live incident on this project, so it is asserted rather than assumed.
  expect(logged).not.toContain(apiKey)
  // Assert the derived values, not merely that the keys exist: all of them are
  // always present with fallbacks, so checking for the key alone would pass
  // even if the values stopped resolving.
  expect(logged).toContain(`"transcriptLength":${text.length}`)
  expect(logged).toContain('"detectedLanguage":"ru"')
})

test('a detected language that is not a language tag is never printed', async () => {
  const written: string[] = []
  const restore = captureConsole(written)

  // The one provider-controlled string this adapter echoes into a log line,
  // and it arrives typed `unknown`. If OpenAI ever put free text there,
  // printing it verbatim would put consultation speech in the logs through the
  // one field the leak test above cannot see.
  try {
    await transcriberReturning({
      text: 'приём',
      language: 'ПАЦИЕНТ ЖАЛУЕТСЯ НА БОЛЬ В ГРУДИ',
    }).transcribe(audio)
  } finally {
    restore()
  }

  const logged = written.join('\n')
  expect(logged).not.toContain('ПАЦИЕНТ')
  expect(logged).not.toContain('ГРУДИ')
  expect(logged).toContain('"detectedLanguage":"(unexpected)"')
})

test('the detected language is logged, since kk-vs-ru is the reason this provider was chosen', async () => {
  const written: string[] = []
  const restore = captureConsole(written)

  try {
    await transcriberReturning({ text: 'приём', language: 'kk' }).transcribe(audio)
  } finally {
    restore()
  }

  // Kazakh coming back detected as Russian is the bug that moved this language
  // off Deepgram; without this field in the log there is no way to see it
  // happen short of reading the med card.
  expect(written.join('\n')).toContain('"detectedLanguage":"kk"')
})

/** Captures the one request the adapter makes, for asserting its shape. */
async function requestFor(options: { language: string | null; contentType?: string }) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const transcriber = createOpenAiTranscriber({
    apiKey: 'sk-test-key',
    language: options.language,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({ text: 'приём' })
    },
  })

  await transcriber.transcribe({
    audio: new Uint8Array([1, 2, 3]),
    contentType: options.contentType ?? 'audio/mp4',
  })

  const call = calls[0]!
  return { url: call.url, init: call.init, form: call.init.body as FormData }
}

test('the recording is posted as multipart with the model and the doctor language', async () => {
  const { url, init, form } = await requestFor({ language: 'kk' })

  expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
  expect(init.method).toBe('POST')
  expect(form).toBeInstanceOf(FormData)
  expect(form.get('model')).toBe('gpt-4o-transcribe')
  expect(form.get('language')).toBe('kk')
  // `gpt-4o-transcribe` accepts no other response format; asking for
  // `verbose_json` — the one that carries a duration — is a 400 on this model.
  expect(form.get('response_format')).toBe('json')
})

test('the content type is carried as a file extension, which is how the provider picks a decoder', async () => {
  // Posting the bytes without a filename is a 400 "invalid file format": the
  // multipart part name is the only place OpenAI learns the container.
  const { form } = await requestFor({ language: 'kk', contentType: 'audio/mp4' })

  const file = form.get('file') as File
  expect(file).toBeInstanceOf(Blob)
  expect(file.name).toMatch(/\.mp4$/)
})

test('a browser recording keeps its own container rather than being mislabelled', async () => {
  const { form } = await requestFor({ language: 'kk', contentType: 'audio/webm;codecs=opus' })

  expect((form.get('file') as File).name).toMatch(/\.webm$/)
})

test('auto-detect omits the language instead of naming one', async () => {
  const { form } = await requestFor({ language: null })

  // The doctor chose "whichever language this visit turns out to be". Naming a
  // language here would be the same mistake that sent Kazakh through a Russian
  // model in the first place.
  expect(form.get('language')).toBeNull()
  expect(form.get('model')).toBe('gpt-4o-transcribe')
})

test('the key travels as a bearer token and never as a query parameter', async () => {
  const { url, init } = await requestFor({ language: 'kk' })

  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sk-test-key')
  expect(url).not.toContain('sk-test-key')
  // Setting it by hand strips the multipart boundary fetch generates, which
  // the provider rejects as a malformed body.
  expect(new Headers(init.headers).get('Content-Type')).toBeNull()
})

test('a rejected request is not mistaken for either a timeout or a long recording', async () => {
  const transcriber = createOpenAiTranscriber({
    apiKey: 'key',
    language: 'kk',
    fetchImpl: async () => new Response('bad model', { status: 400 }),
  })

  const failure = transcriber.transcribe(audio)
  await expect(failure).rejects.toThrow('status 400')
  await expect(failure).rejects.not.toBeInstanceOf(RecordingTooLongError)
  await expect(failure).rejects.not.toBeInstanceOf(TranscriptionTimedOutError)
  await expect(failure).rejects.not.toBeInstanceOf(SpeechNotRecognizedError)
})
