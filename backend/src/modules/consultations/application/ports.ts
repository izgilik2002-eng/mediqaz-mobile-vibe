import type {
  Appointment,
  AppointmentStatus,
  AppointmentSummary,
  DoctorSpecialty,
  MedCard,
} from '@mediqaz/contracts'

import type { ClientReportableStatus } from '../domain/appointment'
import type { ConsultationDoctor } from '../domain/doctor'

/**
 * Narrower than the global `fetch` on purpose: adapters only need to send a
 * request, and tests can substitute it without implementing the whole surface.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type TranscriptionGrant = {
  accessToken: string
  expiresIn: number
}

/**
 * Issues a short-lived credential the doctor's device uses to open its own
 * transcription stream. The long-lived provider key never leaves the backend.
 */
export type TranscriptionGrantIssuer = {
  issue(input: { ttlSeconds: number }): Promise<TranscriptionGrant>
}

export type CompletionMessage = {
  role: 'system' | 'user'
  content: string
}

/** Bounded access to the completion provider. */
export type CompletionClient = {
  complete(input: {
    messages: CompletionMessage[]
    jsonObject?: boolean
  }): Promise<string>
}

export type AudioTranscription = {
  transcript: string
  /** Measured from the audio itself, not reported by the device. */
  durationSeconds: number
}

/**
 * Turns a recorded consultation into text server-side. The device uploads a
 * finished file rather than streaming, so a dropped connection mid-visit does
 * not lose the recording.
 */
export type AudioTranscriber = {
  transcribe(input: {
    audio: Uint8Array<ArrayBuffer>
    contentType: string
  }): Promise<AudioTranscription>
}

/**
 * Persists consultations. Audio is never handed to this port: it is discarded
 * after transcription, so only the transcript and med card are kept.
 */
export type AppointmentStore = {
  start(input: {
    doctorId: string
    specialty: DoctorSpecialty
    patientName?: string
  }): Promise<AppointmentSummary>
  updateStatus(input: {
    appointmentId: string
    doctorId: string
    status: ClientReportableStatus
  }): Promise<AppointmentSummary>
  markGenerating(input: {
    appointmentId: string
    doctorId: string
    transcript: string
    durationSeconds?: number
  }): Promise<AppointmentSummary>
  markCompleted(input: {
    appointmentId: string
    medCard: MedCard
    completedAt: Date
  }): Promise<AppointmentSummary>
  markFailed(input: { appointmentId: string; reason: string }): Promise<AppointmentSummary>
  statusFor(input: {
    appointmentId: string
    doctorId: string
  }): Promise<AppointmentStatus | null>
  listForDoctor(doctorId: string): Promise<{ items: AppointmentSummary[]; total: number }>
  findForDoctor(input: { appointmentId: string; doctorId: string }): Promise<Appointment | null>
}

export type GenerateMedCardInput = {
  doctor: ConsultationDoctor
  appointmentId: string
  transcript: string
  durationSeconds?: number
  customInstructions?: string
  voiceCommands?: string[]
}

export type TranscribeAndGenerateMedCardInput = {
  doctor: ConsultationDoctor
  appointmentId: string
  audio: Uint8Array<ArrayBuffer>
  contentType: string
}

export type AskQuestionInput = {
  doctor: ConsultationDoctor
  transcript: string
  question: string
}

export type ConsultationsService = {
  issueTranscriptionGrant(doctor: ConsultationDoctor): Promise<TranscriptionGrant>
  startAppointment(
    doctor: ConsultationDoctor,
    input?: { patientName?: string },
  ): Promise<AppointmentSummary>
  reportProgress(input: {
    doctor: ConsultationDoctor
    appointmentId: string
    status: ClientReportableStatus
  }): Promise<AppointmentSummary>
  generateMedCard(
    input: GenerateMedCardInput,
  ): Promise<{ medCard: MedCard; appointment: AppointmentSummary }>
  transcribeAndGenerateMedCard(
    input: TranscribeAndGenerateMedCardInput,
  ): Promise<{ medCard: MedCard; appointment: AppointmentSummary }>
  askQuestion(input: AskQuestionInput): Promise<string>
  listAppointments(
    doctor: ConsultationDoctor,
  ): Promise<{ items: AppointmentSummary[]; total: number }>
  getAppointment(input: {
    doctor: ConsultationDoctor
    appointmentId: string
  }): Promise<Appointment>
}
