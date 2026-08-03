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
  | 'recording_too_long'
  | 'live_unavailable_for_language'

/**
 * Thrown by a transcription adapter whose provider refused the recording for
 * being too long. Distinct from a generic failure so the service can tell the
 * doctor to record a shorter visit instead of "try again", which would fail
 * identically forever.
 */
export class RecordingTooLongError extends Error {
  constructor(readonly maxAudioSeconds: number) {
    super(`Recording exceeds the ${maxAudioSeconds}s the provider accepts`)
    this.name = 'RecordingTooLongError'
  }
}

export class ConsultationFailure extends Error {
  constructor(
    readonly code: ConsultationFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'ConsultationFailure'
  }
}
