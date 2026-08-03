import { z } from 'zod'

/**
 * Specialties MediQaz supports. The key is the stored value; the label is the
 * Russian display name used in the app and in generated med-card prompts.
 */
export const doctorSpecialtySchema = z.enum([
  'therapist',
  'pediatrician',
  'cardiologist',
  'surgeon',
  'ent',
  'neurologist',
])

export const SPECIALTY_NAMES: Record<DoctorSpecialty, string> = {
  therapist: 'Терапевт',
  pediatrician: 'Педиатр',
  cardiologist: 'Кардиолог',
  surgeon: 'Хирург',
  ent: 'ЛОР',
  neurologist: 'Невролог',
}

/**
 * Spoken prefixes that mark the rest of an utterance as an instruction to
 * MediQaz rather than part of the consultation. Includes the misrecognitions
 * Deepgram produces most often for the product name.
 */
export const WAKE_WORDS = [
  'медиказ',
  'меди каз',
  'mediqaz',
  'medi qaz',
  'медиказу',
  'медикас',
] as const

/**
 * What the doctor chooses; never a model name. Everything above the transcription
 * router — this contract, the service, the routes, the app — speaks only this
 * vocabulary, so swapping Deepgram for another provider stays one layer deep.
 *
 * `multi` is language auto-detection, not code-switching: the provider picks the
 * dominant language of the recording rather than following a doctor who changes
 * language mid-sentence.
 */
export const transcriptionLanguageSchema = z.enum(['ru', 'kk', 'multi'])

/** What every existing doctor already gets, so the column default is a no-op. */
export const DEFAULT_TRANSCRIPTION_LANGUAGE = 'ru' as const satisfies TranscriptionLanguage

/**
 * Languages whose provider processes the whole recording in one pass and gives
 * up past a hard timeout. Russian has no such cap today, so the limit is per
 * language rather than global — capping Russian would be a regression.
 *
 * The backend enforces this; the constant is here so the app can warn before
 * spending a long upload rather than after.
 */
export const TRANSCRIPTION_CAPPED_LANGUAGES = ['kk', 'multi'] as const
export const TRANSCRIPTION_MAX_AUDIO_SECONDS = 600

export function transcriptionIsCapped(language: TranscriptionLanguage): boolean {
  return (TRANSCRIPTION_CAPPED_LANGUAGES as readonly string[]).includes(language)
}

/** Med-card section order. Drives both rendering and prompt construction. */
export const MED_CARD_SECTIONS = [
  { key: 'жалобы', label: 'Жалобы' },
  { key: 'анамнез', label: 'Анамнез' },
  { key: 'объективно', label: 'Объективно' },
  { key: 'диагноз', label: 'Диагноз' },
  { key: 'назначения', label: 'Назначения' },
  { key: 'рекомендации', label: 'Рекомендации' },
  { key: 'следующий_прием', label: 'Следующий приём' },
] as const

export const MED_CARD_EMPTY_SECTION = 'Не указано в ходе приёма'

const sectionSchema = z.object({
  текст: z.string(),
  цитата: z.string(),
})

const diagnosisSectionSchema = sectionSchema.extend({
  мкб10: z.string(),
})

export const visitTypeSchema = z.enum(['Первичный', 'Повторный'])

export const medCardSchema = z.object({
  тип_приема: visitTypeSchema.nullable(),
  жалобы: sectionSchema,
  анамнез: sectionSchema,
  объективно: sectionSchema,
  диагноз: diagnosisSectionSchema,
  назначения: sectionSchema,
  рекомендации: sectionSchema,
  следующий_прием: sectionSchema,
})

/** Word-level timing from Deepgram, used to play back the audio behind a quote. */
export const wordTimestampSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
})

/**
 * `params` stays an opaque string map on purpose: it is whatever the chosen
 * provider needs on its socket, and the client forwards it without reading it.
 * Naming the keys here would put the model back into the contract.
 */
export const transcriptionTokenResponseSchema = z
  .object({
    accessToken: z.string(),
    expiresIn: z.number().int().positive(),
    params: z.record(z.string(), z.string()),
  })
  .strict()

const transcriptSchema = z.string().trim().min(1).max(100_000)

/**
 * The specialty is taken from the doctor's profile rather than the request, so
 * a client cannot ask for another specialty's prompt.
 */
export const generateMedCardRequestSchema = z.object({
  transcript: transcriptSchema,
  /** Wall-clock length of the recording, reported by the device. */
  durationSeconds: z.number().int().nonnegative().max(24 * 60 * 60).optional(),
  customInstructions: z.string().trim().max(4_000).optional(),
  voiceCommands: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
})

/**
 * Lifecycle of one consultation. `recording`, `processing` and `transcribing`
 * happen on the doctor's device; the backend owns `generating` onwards.
 */
export const appointmentStatusSchema = z.enum([
  'recording',
  'processing',
  'transcribing',
  'generating',
  'completed',
  'failed',
])

/**
 * A stored consultation. Audio is never part of this shape: it is deleted right
 * after transcription, so only the transcript and the med card persist.
 */
export const appointmentSchema = z
  .object({
    id: z.string(),
    status: appointmentStatusSchema,
    specialty: doctorSpecialtySchema,
    patientName: z.string().nullable(),
    transcript: z.string().nullable(),
    medCard: medCardSchema.nullable(),
    durationSeconds: z.number().int().nonnegative().nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict()

export const appointmentSummarySchema = appointmentSchema.omit({
  transcript: true,
  medCard: true,
})

/**
 * The doctor types this in before recording; the client omits the field
 * entirely for a blank input rather than sending an empty string.
 */
export const startAppointmentRequestSchema = z
  .object({
    patientName: z.string().trim().min(1).max(200).optional(),
  })
  .strict()

export const startAppointmentResponseSchema = z
  .object({
    appointment: appointmentSummarySchema,
  })
  .strict()

export const generateMedCardResponseSchema = z
  .object({
    medCard: medCardSchema,
    appointment: appointmentSummarySchema,
  })
  .strict()

export const appointmentParamsSchema = z
  .object({
    appointmentId: z.uuid(),
  })
  .strict()

/**
 * The doctor pastes this into the browser extension once. It is the only thing
 * separating one doctor's delivered med cards from another's: the extension
 * ships its Supabase key publicly, so the key cannot be the secret.
 */
export const misDeliveryCodeResponseSchema = z
  .object({
    code: z.string(),
  })
  .strict()

export const misDeliveryResponseSchema = z
  .object({
    deliveredAt: z.string().datetime(),
    /** When the extension stops being able to claim it and the row is swept. */
    expiresAt: z.string().datetime(),
  })
  .strict()

export const appointmentsResponseSchema = z
  .object({
    items: z.array(appointmentSummarySchema),
    total: z.number().int().nonnegative(),
  })
  .strict()

export const appointmentResponseSchema = z
  .object({
    appointment: appointmentSchema,
  })
  .strict()

export const askAboutConsultationRequestSchema = z.object({
  transcript: transcriptSchema,
  question: z.string().trim().min(1).max(2_000),
})

export const askAboutConsultationResponseSchema = z
  .object({
    answer: z.string(),
  })
  .strict()

export type DoctorSpecialty = z.infer<typeof doctorSpecialtySchema>
export type TranscriptionLanguage = z.infer<typeof transcriptionLanguageSchema>
export type MedCardSectionKey = (typeof MED_CARD_SECTIONS)[number]['key']
export type VisitType = z.infer<typeof visitTypeSchema>
export type MedCard = z.infer<typeof medCardSchema>
export type WordTimestamp = z.infer<typeof wordTimestampSchema>
export type TranscriptionTokenResponse = z.infer<typeof transcriptionTokenResponseSchema>
export type GenerateMedCardRequest = z.infer<typeof generateMedCardRequestSchema>
export type GenerateMedCardResponse = z.infer<typeof generateMedCardResponseSchema>
export type StartAppointmentRequest = z.infer<typeof startAppointmentRequestSchema>
export type StartAppointmentResponse = z.infer<typeof startAppointmentResponseSchema>
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>
export type Appointment = z.infer<typeof appointmentSchema>
export type AppointmentSummary = z.infer<typeof appointmentSummarySchema>
export type AppointmentsResponse = z.infer<typeof appointmentsResponseSchema>
export type AppointmentResponse = z.infer<typeof appointmentResponseSchema>
export type AskAboutConsultationRequest = z.infer<typeof askAboutConsultationRequestSchema>
export type AskAboutConsultationResponse = z.infer<typeof askAboutConsultationResponseSchema>
export type MisDeliveryCodeResponse = z.infer<typeof misDeliveryCodeResponseSchema>
export type MisDeliveryResponse = z.infer<typeof misDeliveryResponseSchema>
