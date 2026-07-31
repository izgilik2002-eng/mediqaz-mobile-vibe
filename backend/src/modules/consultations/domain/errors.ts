export type ConsultationFailureCode =
  | 'not_approved'
  | 'specialty_required'
  | 'appointment_not_found'
  | 'appointment_already_finished'
  | 'transcription_unavailable'
  | 'audio_transcription_failed'
  | 'model_unavailable'
  | 'med_card_unreadable'
  | 'med_card_not_ready'
  | 'mis_delivery_unavailable'

export class ConsultationFailure extends Error {
  constructor(
    readonly code: ConsultationFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConsultationFailure'
  }
}
