import { expect, test } from 'bun:test'

import { MED_CARD_EMPTY_SECTION, type MedCard } from '@mediqaz/contracts'

import { createSupabaseMedCardDeliveryPublisher, toExtensionMedCard } from './supabase-delivery'

const medCard = {
  тип_приема: 'Первичный',
  жалобы: { текст: 'Боль в горле', цитата: 'горло болит' },
  анамнез: { текст: 'Три дня', цитата: 'три дня' },
  объективно: { текст: 'Зев гиперемирован', цитата: 'зев красный' },
  диагноз_врача: { текст: 'Острый фарингит', мкб10: 'J02.9', цитата: 'фарингит' },
  назначения: {
    items: [
      {
        препарат: 'Полоскание фурацилином',
        доза: null,
        кратность: '4 раза в день',
        длительность: '5 дней',
        условие_приема: null,
        цитата: 'полоскать',
      },
    ],
  },
  красные_флаги: { текст: null, цитата: '' },
  рекомендации: { текст: 'Питьё', цитата: 'пить' },
  следующий_прием: { текст: 'Через 5 дней', цитата: 'через пять' },
} satisfies MedCard

const delivery = {
  doctorCode: 'doctor-code-1',
  appointmentId: '00000000-0000-4000-8000-000000000001',
  patientName: 'Иванов И.И.',
  medCard,
  expiresAt: new Date('2026-07-28T10:05:00.000Z'),
}

function capturingPublisher(
  respond: () => Response,
  options: { url?: string } = {},
) {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
  const publisher = createSupabaseMedCardDeliveryPublisher({
    url: options.url ?? 'https://project.supabase.co',
    secretKey: 'secret-key',
    fetchImpl: async (input, init) => {
      calls.push({
        url: input,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      })
      return respond()
    },
  })
  return { publisher, calls }
}

test('upserts against the doctor/appointment pair, not the generated primary key', async () => {
  const { publisher, calls } = capturingPublisher(() => new Response(null, { status: 201 }))

  await publisher.publish(delivery)

  // Without on_conflict, PostgREST resolves the merge against `id`, which a
  // re-send never repeats — so the second delivery of one consultation would
  // hit the unique index instead of replacing the pending row.
  expect(calls[0]?.url).toContain('on_conflict=doctor_code,appointment_id')
  expect(calls[0]?.headers.get('Prefer')).toBe('resolution=merge-duplicates,return=minimal')
})

test('sends the row the extension claims, with an explicit expiry', async () => {
  const { publisher, calls } = capturingPublisher(() => new Response(null, { status: 201 }))

  await publisher.publish(delivery)

  expect(calls[0]?.body).toEqual({
    doctor_code: 'doctor-code-1',
    appointment_id: '00000000-0000-4000-8000-000000000001',
    patient_name: 'Иванов И.И.',
    // Not the raw structured card: the extension is a separate, unmodified
    // codebase that only understands the flat seven-section shape, so what
    // actually reaches PostgREST must already be reshaped for it. Written out
    // by hand rather than via toExtensionMedCard(medCard), so a bug shared
    // between this call site and the one inside publish() cannot hide behind
    // both sides agreeing with each other.
    transcript_json: {
      тип_приема: 'Первичный',
      жалобы: { текст: 'Боль в горле', цитата: 'горло болит' },
      анамнез: { текст: 'Три дня', цитата: 'три дня' },
      объективно: { текст: 'Зев гиперемирован', цитата: 'зев красный' },
      диагноз: { текст: 'Острый фарингит', мкб10: 'J02.9', цитата: 'фарингит' },
      назначения: {
        текст: 'Полоскание фурацилином — 4 раза в день, 5 дней',
        цитата: 'полоскать',
      },
      рекомендации: { текст: 'Питьё', цитата: 'пить' },
      следующий_прием: { текст: 'Через 5 дней', цитата: 'через пять' },
    },
    // The column default only fires on INSERT; a re-send that omitted this
    // would keep the original row's expiry and could be swept immediately.
    expires_at: '2026-07-28T10:05:00.000Z',
  })
  expect(calls[0]?.headers.get('apikey')).toBe('secret-key')
})

test('accepts a project URL pasted with the REST path already on it', async () => {
  const { publisher, calls } = capturingPublisher(() => new Response(null, { status: 201 }), {
    url: 'https://project.supabase.co/rest/v1/',
  })

  await publisher.publish(delivery)

  expect(calls[0]?.url).toBe(
    'https://project.supabase.co/rest/v1/medcard_deliveries?on_conflict=doctor_code,appointment_id',
  )
})

test('fails when PostgREST rejects the write', async () => {
  const { publisher } = capturingPublisher(
    () =>
      new Response(
        JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }),
        { status: 404 },
      ),
  )

  await expect(publisher.publish(delivery)).rejects.toThrow('status 404')
})

test('formats one prescription line per drug, joining only the fields the doctor actually gave', () => {
  const flattened = toExtensionMedCard({
    ...medCard,
    назначения: {
      items: [
        {
          препарат: 'Парацетамол',
          доза: '500 мг',
          кратность: null,
          длительность: null,
          условие_приема: 'только при температуре выше 38.5',
          цитата: 'парацетамол если температура выше 38.5',
        },
        {
          препарат: 'Ибупрофен',
          доза: null,
          кратность: null,
          длительность: null,
          условие_приема: null,
          цитата: '',
        },
      ],
    },
  })

  // Every unspecified field is left out of the line entirely — not printed as
  // the word "null", which would read as if the doctor said that literally.
  expect(flattened.назначения.текст).toBe(
    'Парацетамол — 500 мг, только при температуре выше 38.5\nИбупрофен',
  )
})

test('carries only the first non-blank quote, never several joined together', () => {
  const flattened = toExtensionMedCard({
    ...medCard,
    назначения: {
      items: [
        { препарат: 'A', доза: null, кратность: null, длительность: null, условие_приема: null, цитата: '' },
        { препарат: 'B', доза: null, кратность: null, длительность: null, условие_приема: null, цитата: 'цитата B' },
        { препарат: 'C', доза: null, кратность: null, длительность: null, условие_приема: null, цитата: 'цитата C' },
      ],
    },
  })

  // The extension's Linked Evidence (sidepanel.js findAudioTimestamp) matches
  // a word prefix to find where a quote starts, then plays until an end point
  // derived from the FULL search string's word count. Joining "цитата B /
  // цитата C" would still find B's start correctly but compute an end offset
  // stretched by C's length — the button would look like it points at B and
  // actually play somewhere else in the recording. A dropped a blank quote,
  // so B's — the first real one — must win outright, with nothing appended.
  expect(flattened.назначения.цитата).toBe('цитата B')
})

test('no prescriptions backfills to the same empty-section wording every other section uses', () => {
  const flattened = toExtensionMedCard({ ...medCard, назначения: { items: [] } })

  expect(flattened.назначения.текст).toBe(MED_CARD_EMPTY_SECTION)
  expect(flattened.назначения.цитата).toBe('')
})

test("a diagnosis the doctor never stated never reaches the extension's мкб10 field", () => {
  const flattened = toExtensionMedCard({
    ...medCard,
    диагноз_врача: { текст: null, мкб10: null, цитата: '' },
  })

  // The single most dangerous field in this payload. The extension's
  // buildContentText (content.js) writes мкб10 into the МИС entry as a bare
  // "МКБ-10: {код}" line, so this field must stay empty unless the doctor
  // actually named a code — the model is never asked for one of its own.
  expect(flattened.диагноз.мкб10).toBe('')
  expect(flattened.диагноз.текст).toBe('Диагноз не назван явно')
})

test('the diagnosis line carries only what the doctor said, unchanged', () => {
  const flattened = toExtensionMedCard(medCard)

  expect(flattened.диагноз.текст).toBe('Острый фарингит')
  expect(flattened.диагноз.мкб10).toBe('J02.9')
  expect(flattened.диагноз.цитата).toBe('фарингит')
})

test('a doctor who named only a code is reported as such, not as having said nothing', () => {
  const flattened = toExtensionMedCard({
    ...medCard,
    диагноз_врача: { текст: null, мкб10: 'J02.9', цитата: 'жэ ноль два девять' },
  })

  // "Диагноз не назван явно" next to a filled МКБ-10 line would contradict
  // itself in the МИС entry. The schema allows this state, so it gets its own
  // wording rather than being folded into the "said nothing" case.
  expect(flattened.диагноз.текст).toBe('Диагноз назван только кодом')
  expect(flattened.диагноз.мкб10).toBe('J02.9')
})

test('the flattened card carries no leftover structured diagnosis keys', () => {
  const flattened = toExtensionMedCard(medCard)

  // The extension iterates its own known section keys, so an unfolded
  // диагноз_врача would not be redundant — it would be invisible to the
  // doctor reading the panel. There must be nothing left.
  expect(flattened).not.toHaveProperty('диагноз_врача')
})

test('a red flag is appended to рекомендации under its own heading', () => {
  const flattened = toExtensionMedCard({
    ...medCard,
    красные_флаги: { текст: 'Затруднённое дыхание', цитата: 'если тяжело дышать' },
  })

  expect(flattened.рекомендации.текст).toBe('Питьё\n\nСРОЧНО ОБРАТИТЬСЯ ПРИ: Затруднённое дыхание')
  // рекомендации's own citation is untouched — only its текст gained content.
  expect(flattened.рекомендации.цитата).toBe('пить')
})

test('no red flag leaves рекомендации exactly as the doctor gave it', () => {
  const flattened = toExtensionMedCard({ ...medCard, красные_флаги: { текст: null, цитата: '' } })

  expect(flattened.рекомендации.текст).toBe('Питьё')
  // The extension has no key for this at all, so an unfolded красные_флаги
  // would not just be redundant — it would be silently invisible to a doctor
  // reading the panel. There must be nothing left over to lose.
  expect(flattened).not.toHaveProperty('красные_флаги')
})

test('fails when no response arrives at all', async () => {
  const publisher = createSupabaseMedCardDeliveryPublisher({
    url: 'https://project.supabase.co',
    secretKey: 'secret-key',
    fetchImpl: async () => {
      throw new Error('connect ETIMEDOUT')
    },
  })

  // A network-level failure must not be reported as if the server answered.
  await expect(publisher.publish(delivery)).rejects.toThrow('before a response arrived')
})
