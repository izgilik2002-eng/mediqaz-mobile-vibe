import { expect, test } from 'bun:test'

import type { MedCard } from '@mediqaz/contracts'

import { createSupabaseMedCardDeliveryPublisher } from './supabase-delivery'

const medCard = {
  тип_приема: 'Первичный',
  жалобы: { текст: 'Боль в горле', цитата: 'горло болит' },
  анамнез: { текст: 'Три дня', цитата: 'три дня' },
  объективно: { текст: 'Зев гиперемирован', цитата: 'зев красный' },
  диагноз: { текст: 'Острый фарингит', мкб10: 'J02.9', цитата: 'фарингит' },
  назначения: { текст: 'Полоскание', цитата: 'полоскать' },
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
    transcript_json: medCard,
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
