import type { Appointment, AppointmentSummary, DoctorSpecialty, MedCard } from '@mediqaz/contracts'

import { assertMayGenerate, assertMayReportProgress } from '../domain/appointment'
import { assertMayRecord, requireSpecialty, type ConsultationDoctor } from '../domain/doctor'
import { ConsultationFailure, RecordingTooLongError } from '../domain/errors'
import { MedCardParseError, parseMedCard } from '../domain/med-card'
import {
  buildMedCardSystemPrompt,
  buildMedCardUserPrompt,
  buildQuestionPrompt,
} from '../domain/prompts'
import type {
  AppointmentStore,
  AskQuestionInput,
  AudioTranscriber,
  CompletionClient,
  ConsultationsService,
  GenerateMedCardInput,
  MedCardDeliveryPublisher,
  MisDeliveryCodeStore,
  TranscribeAndGenerateMedCardInput,
  TranscriptionGrant,
  TranscriptionGrantIssuer,
  TranscriptionRouter,
} from './ports'

export type ConsultationsServiceDependencies = {
  appointments: AppointmentStore
  completions: CompletionClient
  transcriptionGrants: TranscriptionGrantIssuer
  /**
   * Resolves the doctor's language to a provider. The service never names a
   * model: that is the router's whole reason to exist.
   */
  transcription?: TranscriptionRouter
  medCardDelivery?: MedCardDeliveryPublisher
  misDeliveryCodes?: MisDeliveryCodeStore
  clock?: { now(): Date }
  /** Long enough to open the stream; the socket outlives the credential. */
  transcriptionGrantTtlSeconds?: number
  misDeliveryTtlHours?: number
}

export function createConsultationsService({
  appointments,
  completions,
  transcriptionGrants,
  transcription,
  medCardDelivery,
  misDeliveryCodes,
  clock = { now: () => new Date() },
  transcriptionGrantTtlSeconds = 300,
  misDeliveryTtlHours = 24,
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

  /**
   * Shared by the text-transcript and audio-upload entry points: both already
   * know the specialty and have confirmed the consultation is still open, so
   * this only runs the model, parses its answer, and persists the result.
   */
  async function runGeneration(
    input: Pick<
      GenerateMedCardInput,
      'appointmentId' | 'doctor' | 'transcript' | 'durationSeconds' | 'customInstructions' | 'voiceCommands'
    >,
    specialty: DoctorSpecialty,
  ) {
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
  }

  return {
    async issueTranscriptionGrant(doctor) {
      assertMayRecord(doctor)

      if (!transcription) {
        throw new ConsultationFailure(
          'transcription_unavailable',
          'Transcription is not configured',
        )
      }

      // Asked before spending a credential: for a language no provider streams,
      // a token would buy a socket that transcribes nothing. Better to say so.
      const params = transcription.streamingParamsFor(doctor.transcriptionLanguage)
      if (!params) {
        throw new ConsultationFailure(
          'live_unavailable_for_language',
          'No provider offers live transcription for this language',
        )
      }

      let grant: TranscriptionGrant
      try {
        grant = await transcriptionGrants.issue({ ttlSeconds: transcriptionGrantTtlSeconds })
      } catch {
        throw new ConsultationFailure(
          'transcription_unavailable',
          'Could not issue a transcription credential',
        )
      }

      return { ...grant, params }
    },

    async startAppointment(doctor, input): Promise<AppointmentSummary> {
      const specialty = requireSpecialty(doctor)
      return appointments.start({ doctorId: doctor.id, specialty, patientName: input?.patientName })
    },

    async reportProgress({ doctor, appointmentId, status }) {
      assertMayRecord(doctor)
      assertMayReportProgress(await requireOwnedStatus(doctor.id, appointmentId))

      return appointments.updateStatus({ appointmentId, doctorId: doctor.id, status })
    },

    async generateMedCard(input: GenerateMedCardInput) {
      const specialty = requireSpecialty(input.doctor)
      assertMayGenerate(await requireOwnedStatus(input.doctor.id, input.appointmentId))

      return runGeneration(input, specialty)
    },

    async transcribeAndGenerateMedCard(input: TranscribeAndGenerateMedCardInput) {
      const specialty = requireSpecialty(input.doctor)
      assertMayGenerate(await requireOwnedStatus(input.doctor.id, input.appointmentId))

      if (!transcription) {
        throw new ConsultationFailure(
          'audio_transcription_failed',
          'Audio transcription is not configured',
        )
      }

      // The doctor's language, not a model. Which provider serves it is decided
      // one layer down, so adding a language never reaches this file.
      const transcriber = transcription.batchTranscriberFor(input.doctor.transcriptionLanguage)

      let result
      try {
        result = await transcriber.transcribe({
          audio: input.audio,
          contentType: input.contentType,
        })
      } catch (cause) {
        // A recording the provider refuses for length fails identically on
        // every retry, so it gets its own answer rather than "try again".
        const reason =
          cause instanceof RecordingTooLongError ? 'recording_too_long' : 'audio_transcription_failed'

        await appointments.markFailed({ appointmentId: input.appointmentId, reason })

        throw new ConsultationFailure(
          reason,
          reason === 'recording_too_long'
            ? 'The recording is longer than the transcription provider accepts'
            : 'Could not transcribe the recording',
        )
      }

      return runGeneration(
        {
          doctor: input.doctor,
          appointmentId: input.appointmentId,
          transcript: result.transcript,
          durationSeconds: result.durationSeconds,
        },
        specialty,
      )
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

    async misDeliveryCode(doctor) {
      assertMayRecord(doctor)
      return requireCodeStore().ensureFor(doctor.id)
    },

    async regenerateMisDeliveryCode(doctor) {
      assertMayRecord(doctor)
      return requireCodeStore().regenerateFor(doctor.id)
    },

    async sendMedCardToMis({ doctor, appointmentId }) {
      assertMayRecord(doctor)

      if (!medCardDelivery) {
        throw new ConsultationFailure(
          'mis_delivery_unavailable',
          'Med card delivery is not configured',
        )
      }

      const appointment = await appointments.findForDoctor({ appointmentId, doctorId: doctor.id })
      if (!appointment) {
        throw new ConsultationFailure('appointment_not_found', 'Consultation not found')
      }

      // Re-sending is the whole point of this endpoint, so a completed
      // consultation may be delivered any number of times. What it may not be
      // is delivered before the model has produced anything to deliver.
      if (!appointment.medCard) {
        throw new ConsultationFailure(
          'med_card_not_ready',
          'This consultation has no med card yet',
        )
      }

      const deliveredAt = clock.now()
      const expiresAt = new Date(deliveredAt.getTime() + misDeliveryTtlHours * 60 * 60 * 1000)

      try {
        await medCardDelivery.publish({
          doctorCode: await requireCodeStore().ensureFor(doctor.id),
          appointmentId,
          patientName: appointment.patientName ?? undefined,
          medCard: appointment.medCard,
          expiresAt,
        })
      } catch {
        throw new ConsultationFailure(
          'mis_delivery_unavailable',
          'Could not hand the med card to the delivery channel',
        )
      }

      return { deliveredAt, expiresAt }
    },
  }

  function requireCodeStore(): MisDeliveryCodeStore {
    if (!misDeliveryCodes) {
      throw new ConsultationFailure(
        'mis_delivery_unavailable',
        'Med card delivery is not configured',
      )
    }
    return misDeliveryCodes
  }
}
