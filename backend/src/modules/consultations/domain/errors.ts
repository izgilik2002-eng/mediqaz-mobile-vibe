export type ConsultationFailureCode =
  | 'not_approved'
  | 'specialty_required'
  | 'appointment_not_found'
  | 'appointment_already_finished'
  | 'transcription_unavailable'
  | 'model_unavailable'
  | 'med_card_unreadable'

export class ConsultationFailure extends Error {
  constructor(
    readonly code: ConsultationFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConsultationFailure'
  }
}
