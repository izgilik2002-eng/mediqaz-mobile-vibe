import type { Appointment, AppointmentSummary, MedCard } from '@mediqaz/contracts'

import { assertMayGenerate, assertMayReportProgress } from '../domain/appointment'
import { assertMayRecord, requireSpecialty, type ConsultationDoctor } from '../domain/doctor'
import { ConsultationFailure } from '../domain/errors'
import { MedCardParseError, parseMedCard } from '../domain/med-card'
import {
  buildMedCardSystemPrompt,
  buildMedCardUserPrompt,
  buildQuestionPrompt,
} from '../domain/prompts'
import type {
  AppointmentStore,
  AskQuestionInput,
  CompletionClient,
  ConsultationsService,
  GenerateMedCardInput,
  TranscriptionGrant,
  TranscriptionGrantIssuer,
} from './ports'

export type ConsultationsServiceDependencies = {
  appointments: AppointmentStore
  completions: CompletionClient
  transcriptionGrants: TranscriptionGrantIssuer
  clock?: { now(): Date }
  /** Long enough to open the stream; the socket outlives the credential. */
  transcriptionGrantTtlSeconds?: number
}

export function createConsultationsService({
  appointments,
  completions,
  transcriptionGrants,
  clock = { now: () => new Date() },
  transcriptionGrantTtlSeconds = 300,
}: ConsultationsServiceDependencies): ConsultationsService {
  async function requireOwnedStatus(doctorId: string, appointmentId: string) {
    const status = await appointments.statusFor({ appointmentId, doctorId })

    // Scoped by doctor, so another doctor's consultation is indistinguishable
    // from one that does not exist.
    if (!status) {
      throw new ConsultationFailure('appointment_not_found', 'Consultation not found')
    }
    return status
  }

  return {
    async issueTranscriptionGrant(doctor): Promise<TranscriptionGrant> {
      assertMayRecord(doctor)

      try {
        return await transcriptionGrants.issue({ ttlSeconds: transcriptionGrantTtlSeconds })
      } catch {
        throw new ConsultationFailure(
          'transcription_unavailable',
          'Could not issue a transcription credential',
        )
      }
    },

    async startAppointment(doctor: ConsultationDoctor): Promise<AppointmentSummary> {
      const specialty = requireSpecialty(doctor)
      return appointments.start({ doctorId: doctor.id, specialty })
    },

    async reportProgress({ doctor, appointmentId, status }) {
      assertMayRecord(doctor)
      assertMayReportProgress(await requireOwnedStatus(doctor.id, appointmentId))

      return appointments.updateStatus({ appointmentId, doctorId: doctor.id, status })
    },

    async generateMedCard(input: GenerateMedCardInput) {
      const specialty = requireSpecialty(input.doctor)
      assertMayGenerate(await requireOwnedStatus(input.doctor.id, input.appointmentId))

      // The transcript is stored before the model runs, so a failed generation
      // leaves a visible failed consultation with its transcript intact rather
      // than losing the appointment entirely.
      await appointments.markGenerating({
        appointmentId: input.appointmentId,
        doctorId: input.doctor.id,
        transcript: input.transcript,
        durationSeconds: input.durationSeconds,
      })

      let completion: string
      try {
        completion = await completions.complete({
          messages: [
            {
              role: 'system',
              content: buildMedCardSystemPrompt({
                specialty,
                customInstructions: input.customInstructions,
                voiceCommands: input.voiceCommands,
              }),
            },
            { role: 'user', content: buildMedCardUserPrompt(input.transcript) },
          ],
          jsonObject: true,
        })
      } catch {
        await appointments.markFailed({
          appointmentId: input.appointmentId,
          reason: 'model_unavailable',
        })
        throw new ConsultationFailure('model_unavailable', 'The model is currently unavailable')
      }

      let medCard: MedCard
      try {
        medCard = parseMedCard(completion)
      } catch (error) {
        if (error instanceof MedCardParseError) {
          await appointments.markFailed({
            appointmentId: input.appointmentId,
            reason: 'med_card_unreadable',
          })
          throw new ConsultationFailure(
            'med_card_unreadable',
            'The model response could not be read as a med card',
          )
        }
        throw error
      }

      const appointment = await appointments.markCompleted({
        appointmentId: input.appointmentId,
        medCard,
        completedAt: clock.now(),
      })

      return { medCard, appointment }
    },

    async askQuestion(input: AskQuestionInput): Promise<string> {
      const specialty = requireSpecialty(input.doctor)
      const prompt = buildQuestionPrompt({
        specialty,
        transcript: input.transcript,
        question: input.question,
      })

      try {
        return await completions.complete({
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        })
      } catch {
        throw new ConsultationFailure('model_unavailable', 'The model is currently unavailable')
      }
    },

    async listAppointments(doctor: ConsultationDoctor) {
      assertMayRecord(doctor)
      return appointments.listForDoctor(doctor.id)
    },

    async getAppointment({ doctor, appointmentId }): Promise<Appointment> {
      assertMayRecord(doctor)

      const appointment = await appointments.findForDoctor({
        appointmentId,
        doctorId: doctor.id,
      })

      if (!appointment) {
        throw new ConsultationFailure('appointment_not_found', 'Consultation not found')
      }

      return appointment
    },
  }
}
