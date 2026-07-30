import { expect, test } from 'bun:test'

import type { AppointmentStatus, AppointmentSummary, MedCard } from '@mediqaz/contracts'
import { MED_CARD_EMPTY_SECTION } from '@mediqaz/contracts'

import type { ConsultationDoctor } from '../domain/doctor'
import type {
  AppointmentStore,
  AudioTranscriber,
  CompletionClient,
  CompletionMessage,
  TranscriptionGrantIssuer,
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

const approvedDoctor: ConsultationDoctor = {
  id: 'doctor-1',
  isApproved: true,
  specialty: 'therapist',
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

function createStore(options: { status?: AppointmentStatus | null } = {}) {
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
    findForDoctor: async () => ({
      ...summary,
      transcript: 'приём',
      medCard: null,
    }),
  }

  return { store, calls }
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

function createService(overrides: {
  store?: AppointmentStore
  completions?: CompletionClient
  transcriptionGrants?: TranscriptionGrantIssuer
  audioTranscriber?: AudioTranscriber
} = {}) {
  return createConsultationsService({
    appointments: overrides.store ?? createStore().store,
    completions: overrides.completions ?? completionsReturning(medCardJson),
    transcriptionGrants: overrides.transcriptionGrants ?? workingGrants,
    audioTranscriber: overrides.audioTranscriber ?? workingAudioTranscriber,
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

test('issues a transcription grant with the configured lifetime', async () => {
  const service = createConsultationsService({
    appointments: createStore().store,
    completions: completionsReturning(medCardJson),
    transcriptionGrants: workingGrants,
    transcriptionGrantTtlSeconds: 120,
  })

  await expect(service.issueTranscriptionGrant(approvedDoctor)).resolves.toEqual({
    accessToken: 'grant-token',
    expiresIn: 120,
  })
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
