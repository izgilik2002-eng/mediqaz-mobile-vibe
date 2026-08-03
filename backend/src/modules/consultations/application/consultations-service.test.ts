import { expect, test } from 'bun:test'

import type { AppointmentStatus, AppointmentSummary, MedCard } from '@mediqaz/contracts'
import { MED_CARD_EMPTY_SECTION } from '@mediqaz/contracts'

import type { ConsultationDoctor } from '../domain/doctor'
import { RecordingTooLongError } from '../domain/errors'
import type {
  AppointmentStore,
  AudioTranscriber,
  CompletionClient,
  CompletionMessage,
  MedCardDeliveryPublisher,
  MisDeliveryCodeStore,
  TranscriptionGrantIssuer,
  TranscriptionRouter,
} from './ports'
import { createConsultationsService } from './consultations-service'

const medCardJson = JSON.stringify({
  тип_приема: 'Первичный',
  жалобы: { текст: 'Боль в горле', цитата: 'горло болит' },
  анамнез: { текст: 'Три дня', цитата: 'три дня' },
  объективно: { текст: 'Зев гиперемирован', цитата: 'зев красный' },
  диагноз: { текст: 'Острый фарингит', мкб10: 'J02.9', цитата: 'фарингит' },
  назначения: { текст: 'Полоскание', цитата: 'полоскать' },
  рекомендации: { текст: 'Питьё', цитата: 'пить' },
  следующий_прием: { текст: 'Через 5 дней', цитата: 'через пять' },
})

const sampleMedCard: MedCard = JSON.parse(medCardJson)

const approvedDoctor: ConsultationDoctor = {
  id: 'doctor-1',
  isApproved: true,
  specialty: 'therapist',
  transcriptionLanguage: 'ru',
}

const summary: AppointmentSummary = {
  id: 'appointment-1',
  status: 'recording',
  specialty: 'therapist',
  patientName: null,
  durationSeconds: null,
  createdAt: '2026-07-27T10:00:00.000Z',
  completedAt: null,
}

type StoreCalls = {
  started: unknown[]
  generating: unknown[]
  completed: unknown[]
  failed: unknown[]
  statuses: unknown[]
}

function createStore(
  options: {
    status?: AppointmentStatus | null
    medCard?: MedCard | null
    patientName?: string | null
    missing?: boolean
  } = {},
) {
  const calls: StoreCalls = {
    started: [],
    generating: [],
    completed: [],
    failed: [],
    statuses: [],
  }

  const store: AppointmentStore = {
    start: async (input) => {
      calls.started.push(input)
      return summary
    },
    updateStatus: async (input) => {
      calls.statuses.push(input)
      return { ...summary, status: input.status }
    },
    markGenerating: async (input) => {
      calls.generating.push(input)
      return { ...summary, status: 'generating' }
    },
    markCompleted: async (input) => {
      calls.completed.push(input)
      return { ...summary, status: 'completed', completedAt: '2026-07-27T10:05:00.000Z' }
    },
    markFailed: async (input) => {
      calls.failed.push(input)
      return { ...summary, status: 'failed' }
    },
    statusFor: async () => (options.status === undefined ? 'recording' : options.status),
    listForDoctor: async () => ({ items: [summary], total: 1 }),
    findForDoctor: async () =>
      options.missing
        ? null
        : {
            ...summary,
            patientName: options.patientName ?? null,
            transcript: 'приём',
            medCard: options.medCard === undefined ? null : options.medCard,
          },
  }

  return { store, calls }
}

function createDeliveryPublisher(options: { fail?: boolean } = {}) {
  const calls: Array<Parameters<MedCardDeliveryPublisher['publish']>[0]> = []
  const publisher: MedCardDeliveryPublisher = {
    publish: async (input) => {
      calls.push(input)
      if (options.fail) throw new Error('supabase unreachable')
    },
  }
  return { publisher, calls }
}

function createCodeStore(options: { code?: string } = {}) {
  const ensured: string[] = []
  const regenerated: string[] = []
  const store: MisDeliveryCodeStore = {
    ensureFor: async (doctorId) => {
      ensured.push(doctorId)
      return options.code ?? 'delivery-code-1'
    },
    regenerateFor: async (doctorId) => {
      regenerated.push(doctorId)
      return 'delivery-code-2'
    },
  }
  return { store, ensured, regenerated }
}

function completionsReturning(content: string, capture?: { calls: unknown[] }): CompletionClient {
  return {
    complete: async (input) => {
      capture?.calls.push(input)
      return content
    },
  }
}

const workingGrants: TranscriptionGrantIssuer = {
  issue: async ({ ttlSeconds }) => ({ accessToken: 'grant-token', expiresIn: ttlSeconds }),
}

const workingAudioTranscriber: AudioTranscriber = {
  transcribe: async () => ({ transcript: 'доктор: на что жалуетесь', durationSeconds: 180 }),
}

/**
 * Production has exactly one path from a language to a provider — the router.
 * These tests are about the service's own rules, not that mapping (which has
 * its own test), so they hand it a router that answers the same transcriber for
 * every language.
 */
function routerFor(
  transcriber: AudioTranscriber,
  streamingParams: Record<string, string> | null = { model: 'test-model' },
): TranscriptionRouter {
  return {
    batchTranscriberFor: () => transcriber,
    streamingParamsFor: () => streamingParams,
  }
}

function createService(overrides: {
  store?: AppointmentStore
  completions?: CompletionClient
  transcriptionGrants?: TranscriptionGrantIssuer
  audioTranscriber?: AudioTranscriber
  transcription?: TranscriptionRouter
  medCardDelivery?: MedCardDeliveryPublisher
  misDeliveryCodes?: MisDeliveryCodeStore
  misDeliveryTtlHours?: number
} = {}) {
  return createConsultationsService({
    appointments: overrides.store ?? createStore().store,
    completions: overrides.completions ?? completionsReturning(medCardJson),
    transcriptionGrants: overrides.transcriptionGrants ?? workingGrants,
    transcription:
      overrides.transcription ?? routerFor(overrides.audioTranscriber ?? workingAudioTranscriber),
    medCardDelivery: overrides.medCardDelivery,
    // Unlike medCardDelivery, the real module wiring (index.ts) never leaves
    // this unset — it always creates a Prisma-backed code store. Defaulting it
    // here keeps that asymmetry faithful instead of every delivery test having
    // to know it needs one.
    misDeliveryCodes: overrides.misDeliveryCodes ?? createCodeStore().store,
    misDeliveryTtlHours: overrides.misDeliveryTtlHours,
    clock: { now: () => new Date('2026-07-27T10:05:00.000Z') },
  })
}

test('refuses every consultation capability to an unapproved doctor', async () => {
  const { store, calls } = createStore()
  const service = createService({ store })
  const unapproved: ConsultationDoctor = { ...approvedDoctor, isApproved: false }

  await expect(service.issueTranscriptionGrant(unapproved)).rejects.toMatchObject({
    code: 'not_approved',
  })
  await expect(service.startAppointment(unapproved)).rejects.toMatchObject({
    code: 'not_approved',
  })
  await expect(
    service.generateMedCard({
      doctor: unapproved,
      appointmentId: 'appointment-1',
      transcript: 'приём',
    }),
  ).rejects.toMatchObject({ code: 'not_approved' })
  await expect(
    service.askQuestion({ doctor: unapproved, transcript: 'приём', question: 'диагноз?' }),
  ).rejects.toMatchObject({ code: 'not_approved' })
  await expect(service.listAppointments(unapproved)).rejects.toMatchObject({
    code: 'not_approved',
  })
  await expect(
    service.sendMedCardToMis({ doctor: unapproved, appointmentId: 'appointment-1' }),
  ).rejects.toMatchObject({ code: 'not_approved' })

  // Nothing reached the providers or the database.
  expect(calls.started).toHaveLength(0)
  expect(calls.generating).toHaveLength(0)
})

test('asks an approved doctor without a specialty to complete their profile', async () => {
  const service = createService()
  const withoutSpecialty: ConsultationDoctor = { ...approvedDoctor, specialty: null }

  await expect(service.startAppointment(withoutSpecialty)).rejects.toMatchObject({
    code: 'specialty_required',
  })
  await expect(
    service.generateMedCard({
      doctor: withoutSpecialty,
      appointmentId: 'appointment-1',
      transcript: 'приём',
    }),
  ).rejects.toMatchObject({ code: 'specialty_required' })
})

test('opens a consultation with the doctor profile specialty', async () => {
  const { store, calls } = createStore()
  const service = createService({ store })

  await expect(service.startAppointment(approvedDoctor)).resolves.toEqual(summary)
  expect(calls.started).toEqual([{ doctorId: 'doctor-1', specialty: 'therapist' }])
})

test('passes the patient name through to the store when the doctor provides one', async () => {
  const { store, calls } = createStore()
  const service = createService({ store })

  await service.startAppointment(approvedDoctor, { patientName: 'Иванов И.И.' })
  expect(calls.started).toEqual([
    { doctorId: 'doctor-1', specialty: 'therapist', patientName: 'Иванов И.И.' },
  ])
})

test('stores the transcript and duration before the model runs', async () => {
  const { store, calls } = createStore()
  const service = createService({ store })

  const result = await service.generateMedCard({
    doctor: approvedDoctor,
    appointmentId: 'appointment-1',
    transcript: 'доктор: горло болит',
    durationSeconds: 412,
  })

  expect(calls.generating).toEqual([
    {
      appointmentId: 'appointment-1',
      doctorId: 'doctor-1',
      transcript: 'доктор: горло болит',
      durationSeconds: 412,
    },
  ])
  expect(result.medCard.диагноз.мкб10).toBe('J02.9')
  expect(result.appointment.status).toBe('completed')
})

test('marks the consultation failed when the model is unavailable', async () => {
  const { store, calls } = createStore()
  const service = createService({
    store,
    completions: {
      complete: async () => {
        throw new Error('groq 503')
      },
    },
  })

  await expect(
    service.generateMedCard({
      doctor: approvedDoctor,
      appointmentId: 'appointment-1',
      transcript: 'приём',
    }),
  ).rejects.toMatchObject({ code: 'model_unavailable' })

  expect(calls.failed).toEqual([
    { appointmentId: 'appointment-1', reason: 'model_unavailable' },
  ])
  expect(calls.completed).toHaveLength(0)
})

test('marks the consultation failed when the model response is unreadable', async () => {
  const { store, calls } = createStore()
  const service = createService({ store, completions: completionsReturning('Извините.') })

  await expect(
    service.generateMedCard({
      doctor: approvedDoctor,
      appointmentId: 'appointment-1',
      transcript: 'приём',
    }),
  ).rejects.toMatchObject({ code: 'med_card_unreadable' })

  expect(calls.failed).toEqual([
    { appointmentId: 'appointment-1', reason: 'med_card_unreadable' },
  ])
})

test('transcribes a recording server-side and generates the med card from it', async () => {
  const { store, calls } = createStore()
  const service = createService({ store })

  const result = await service.transcribeAndGenerateMedCard({
    doctor: approvedDoctor,
    appointmentId: 'appointment-1',
    audio: new Uint8Array([1, 2, 3]),
    contentType: 'audio/mp4',
  })

  // Duration comes from what Deepgram measured in the audio, not a
  // client-reported number, so the transcript and duration in `markGenerating`
  // are exactly what the transcriber returned.
  expect(calls.generating).toEqual([
    {
      appointmentId: 'appointment-1',
      doctorId: 'doctor-1',
      transcript: 'доктор: на что жалуетесь',
      durationSeconds: 180,
    },
  ])
  expect(result.medCard.диагноз.мкб10).toBe('J02.9')
  expect(result.appointment.status).toBe('completed')
})

test('marks the consultation failed when the recording cannot be transcribed', async () => {
  const { store, calls } = createStore()
  const service = createService({
    store,
    audioTranscriber: {
      transcribe: async () => {
        throw new Error('deepgram 400')
      },
    },
  })

  await expect(
    service.transcribeAndGenerateMedCard({
      doctor: approvedDoctor,
      appointmentId: 'appointment-1',
      audio: new Uint8Array([1, 2, 3]),
      contentType: 'audio/mp4',
    }),
  ).rejects.toMatchObject({ code: 'audio_transcription_failed' })

  expect(calls.failed).toEqual([
    { appointmentId: 'appointment-1', reason: 'audio_transcription_failed' },
  ])
  expect(calls.generating).toHaveLength(0)
})

test('checks ownership and specialty before spending a transcription call', async () => {
  const { store, calls } = createStore({ status: 'completed' })
  let transcribeCalls = 0
  const service = createService({
    store,
    audioTranscriber: {
      transcribe: async () => {
        transcribeCalls += 1
        return { transcript: 'приём', durationSeconds: 10 }
      },
    },
  })

  await expect(
    service.transcribeAndGenerateMedCard({
      doctor: approvedDoctor,
      appointmentId: 'appointment-1',
      audio: new Uint8Array([1, 2, 3]),
      contentType: 'audio/mp4',
    }),
  ).rejects.toMatchObject({ code: 'appointment_already_finished' })

  expect(transcribeCalls).toBe(0)
  expect(calls.failed).toHaveLength(0)
})

test('refuses to regenerate a finished consultation', async () => {
  const { store, calls } = createStore({ status: 'completed' })
  const service = createService({ store })

  await expect(
    service.generateMedCard({
      doctor: approvedDoctor,
      appointmentId: 'appointment-1',
      transcript: 'приём',
    }),
  ).rejects.toMatchObject({ code: 'appointment_already_finished' })
  await expect(
    service.reportProgress({
      doctor: approvedDoctor,
      appointmentId: 'appointment-1',
      status: 'recording',
    }),
  ).rejects.toMatchObject({ code: 'appointment_already_finished' })

  expect(calls.generating).toHaveLength(0)
})

test("treats another doctor's consultation as missing", async () => {
  const { store } = createStore({ status: null })
  const service = createService({ store })

  await expect(
    service.generateMedCard({
      doctor: approvedDoctor,
      appointmentId: 'someone-elses',
      transcript: 'приём',
    }),
  ).rejects.toMatchObject({ code: 'appointment_not_found' })
})

test('records device-side progress', async () => {
  const { store, calls } = createStore()
  const service = createService({ store })

  const appointment = await service.reportProgress({
    doctor: approvedDoctor,
    appointmentId: 'appointment-1',
    status: 'transcribing',
  })

  expect(appointment.status).toBe('transcribing')
  expect(calls.statuses).toEqual([
    { appointmentId: 'appointment-1', doctorId: 'doctor-1', status: 'transcribing' },
  ])
})

test('sends the specialty prompt and requests a JSON object for med cards', async () => {
  const capture = { calls: [] as unknown[] }
  const service = createService({
    completions: completionsReturning(medCardJson, capture),
  })

  await service.generateMedCard({
    doctor: { ...approvedDoctor, specialty: 'cardiologist' },
    appointmentId: 'appointment-1',
    transcript: 'доктор: на что жалуетесь',
  })

  const [call] = capture.calls as Array<{ messages: CompletionMessage[]; jsonObject?: boolean }>
  expect(call.jsonObject).toBe(true)
  expect(call.messages[0]?.content).toContain('Кардиолог')
  expect(call.messages[0]?.content).toContain(MED_CARD_EMPTY_SECTION)
  expect(call.messages[1]?.content).toContain('доктор: на что жалуетесь')
})

test('puts doctor voice commands above personal instructions in the prompt', async () => {
  const capture = { calls: [] as unknown[] }
  const service = createService({
    completions: completionsReturning(medCardJson, capture),
  })

  await service.generateMedCard({
    doctor: approvedDoctor,
    appointmentId: 'appointment-1',
    transcript: 'приём',
    customInstructions: 'Всегда указывай аллергии',
    voiceCommands: ['добавь направление к лору'],
  })

  const [call] = capture.calls as Array<{ messages: CompletionMessage[] }>
  const system = call.messages[0]?.content ?? ''
  expect(system).toContain('Всегда указывай аллергии')
  expect(system).toContain('добавь направление к лору')
  expect(system.indexOf('ГОЛОСОВЫЕ КОМАНДЫ')).toBeGreaterThan(
    system.indexOf('ПЕРСОНАЛЬНЫЕ ИНСТРУКЦИИ'),
  )
})

test('grounds consultation answers in the transcript without asking for JSON', async () => {
  const capture = { calls: [] as unknown[] }
  const service = createService({
    completions: completionsReturning('Диагноз — фарингит.', capture),
  })

  const answer = await service.askQuestion({
    doctor: { ...approvedDoctor, specialty: 'ent' },
    transcript: 'доктор: похоже на фарингит',
    question: 'какой диагноз?',
  })

  expect(answer).toContain('фарингит')
  const [call] = capture.calls as Array<{ messages: CompletionMessage[]; jsonObject?: boolean }>
  expect(call.jsonObject).toBeUndefined()
  expect(call.messages[0]?.content).toContain('ЛОР')
})

test('reports a transcription provider outage as a domain failure', async () => {
  const service = createService({
    transcriptionGrants: {
      issue: async () => {
        throw new Error('provider down')
      },
    },
  })

  await expect(service.issueTranscriptionGrant(approvedDoctor)).rejects.toMatchObject({
    code: 'transcription_unavailable',
  })
})

test('issues a transcription grant with the configured lifetime and the provider parameters', async () => {
  const service = createConsultationsService({
    appointments: createStore().store,
    completions: completionsReturning(medCardJson),
    transcriptionGrants: workingGrants,
    transcription: routerFor(workingAudioTranscriber, { model: 'nova-2', language: 'ru' }),
    transcriptionGrantTtlSeconds: 120,
  })

  await expect(service.issueTranscriptionGrant(approvedDoctor)).resolves.toEqual({
    accessToken: 'grant-token',
    expiresIn: 120,
    params: { model: 'nova-2', language: 'ru' },
  })
})

test('refuses a live credential for a language no provider streams', async () => {
  let issued = 0
  const service = createService({
    transcription: routerFor(workingAudioTranscriber, null),
    transcriptionGrants: {
      issue: async ({ ttlSeconds }) => {
        issued += 1
        return { accessToken: 'grant-token', expiresIn: ttlSeconds }
      },
    },
  })

  await expect(
    service.issueTranscriptionGrant({ ...approvedDoctor, transcriptionLanguage: 'kk' }),
  ).rejects.toMatchObject({ code: 'live_unavailable_for_language' })

  // Asked before the credential is bought: a token here would only buy a socket
  // that transcribes nothing.
  expect(issued).toBe(0)
})

test('asks the router for the doctor language, not a hardcoded one', async () => {
  const asked: string[] = []
  const service = createService({
    transcription: {
      batchTranscriberFor: (language) => {
        asked.push(language)
        return workingAudioTranscriber
      },
      streamingParamsFor: () => null,
    },
  })

  await service.transcribeAndGenerateMedCard({
    doctor: { ...approvedDoctor, transcriptionLanguage: 'kk' },
    appointmentId: 'appointment-1',
    audio: new Uint8Array([1, 2, 3]),
    contentType: 'audio/mp4',
  })

  expect(asked).toEqual(['kk'])
})

test('tells the doctor a recording was too long instead of asking for a retry', async () => {
  const { store, calls } = createStore()
  const service = createService({
    store,
    audioTranscriber: {
      transcribe: async () => {
        throw new RecordingTooLongError(600)
      },
    },
  })

  await expect(
    service.transcribeAndGenerateMedCard({
      doctor: approvedDoctor,
      appointmentId: 'appointment-1',
      audio: new Uint8Array([1, 2, 3]),
      contentType: 'audio/mp4',
    }),
  ).rejects.toMatchObject({ code: 'recording_too_long' })

  // Recorded as its own reason: "audio_transcription_failed" would suggest a
  // transient provider problem, and the doctor would retry the same file.
  expect(calls.failed).toEqual([
    { appointmentId: 'appointment-1', reason: 'recording_too_long' },
  ])
})

test('never serves a med card the stored shape no longer matches', async () => {
  const { store } = createStore()
  const service = createService({ store })

  const appointment = await service.getAppointment({
    doctor: approvedDoctor,
    appointmentId: 'appointment-1',
  })

  expect(appointment.medCard satisfies MedCard | null).toBeNull()
})

test('hands a finished med card to the delivery channel under the doctor code', async () => {
  const { store } = createStore({ medCard: sampleMedCard, patientName: 'Иванов И.И.' })
  const { publisher, calls } = createDeliveryPublisher()
  const { store: codes, ensured } = createCodeStore({ code: 'doctor-code-1' })
  const service = createService({ store, medCardDelivery: publisher, misDeliveryCodes: codes })

  const result = await service.sendMedCardToMis({
    doctor: approvedDoctor,
    appointmentId: 'appointment-1',
  })

  // The code is fetched fresh rather than cached on the doctor object, so a
  // regenerated code takes effect on the very next delivery.
  expect(ensured).toEqual(['doctor-1'])
  expect(calls).toEqual([
    {
      doctorCode: 'doctor-code-1',
      appointmentId: 'appointment-1',
      patientName: 'Иванов И.И.',
      medCard: sampleMedCard,
      expiresAt: result.expiresAt,
    },
  ])
  expect(result.deliveredAt).toEqual(new Date('2026-07-27T10:05:00.000Z'))
  // Default TTL is 24 hours when the module does not override it.
  expect(result.expiresAt).toEqual(new Date('2026-07-28T10:05:00.000Z'))
})

test('sends no patient name to the delivery channel when none was recorded', async () => {
  const { store } = createStore({ medCard: sampleMedCard, patientName: null })
  const { publisher, calls } = createDeliveryPublisher()
  const service = createService({ store, medCardDelivery: publisher })

  await service.sendMedCardToMis({ doctor: approvedDoctor, appointmentId: 'appointment-1' })

  expect(calls[0]?.patientName).toBeUndefined()
})

test('honors a configured delivery TTL instead of the 24-hour default', async () => {
  const { store } = createStore({ medCard: sampleMedCard })
  const { publisher, calls } = createDeliveryPublisher()
  const service = createService({
    store,
    medCardDelivery: publisher,
    misDeliveryTtlHours: 1,
  })

  await service.sendMedCardToMis({ doctor: approvedDoctor, appointmentId: 'appointment-1' })

  expect(calls[0]?.expiresAt).toEqual(new Date('2026-07-27T11:05:00.000Z'))
})

test('refuses to deliver a consultation with no med card yet', async () => {
  const { store } = createStore({ medCard: null })
  const { publisher, calls } = createDeliveryPublisher()
  const service = createService({ store, medCardDelivery: publisher })

  await expect(
    service.sendMedCardToMis({ doctor: approvedDoctor, appointmentId: 'appointment-1' }),
  ).rejects.toMatchObject({ code: 'med_card_not_ready' })

  expect(calls).toHaveLength(0)
})

test("treats another doctor's consultation as missing when delivering", async () => {
  const { store } = createStore({ missing: true })
  const { publisher } = createDeliveryPublisher()
  const service = createService({ store, medCardDelivery: publisher })

  await expect(
    service.sendMedCardToMis({ doctor: approvedDoctor, appointmentId: 'someone-elses' }),
  ).rejects.toMatchObject({ code: 'appointment_not_found' })
})

test('reports a delivery channel outage without leaking the underlying cause', async () => {
  const { store } = createStore({ medCard: sampleMedCard })
  const { publisher } = createDeliveryPublisher({ fail: true })
  const service = createService({ store, medCardDelivery: publisher })

  await expect(
    service.sendMedCardToMis({ doctor: approvedDoctor, appointmentId: 'appointment-1' }),
  ).rejects.toMatchObject({ code: 'mis_delivery_unavailable' })
})

test('refuses delivery when no channel is configured, without touching the store', async () => {
  const { store } = createStore({ medCard: sampleMedCard })
  const service = createService({ store })

  await expect(
    service.sendMedCardToMis({ doctor: approvedDoctor, appointmentId: 'appointment-1' }),
  ).rejects.toMatchObject({ code: 'mis_delivery_unavailable' })
})

test('a re-send is allowed: delivering the same completed consultation twice both succeed', async () => {
  const { store } = createStore({ medCard: sampleMedCard })
  const { publisher, calls } = createDeliveryPublisher()
  const service = createService({ store, medCardDelivery: publisher })

  await service.sendMedCardToMis({ doctor: approvedDoctor, appointmentId: 'appointment-1' })
  await service.sendMedCardToMis({ doctor: approvedDoctor, appointmentId: 'appointment-1' })

  expect(calls).toHaveLength(2)
})
