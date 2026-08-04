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
  | 'transcription_timed_out'
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

/**
 * The provider did not answer within our budget. Deliberately distinct from
 * `RecordingTooLongError`: Deepgram's Whisper has been measured taking anywhere
 * from one second to over three minutes on the same three-second file, so a
 * timeout says nothing about the recording. Telling the doctor to record a
 * shorter visit would send them to shorten something that was never the
 * problem, and the same file often succeeds on the next attempt.
 */
export class TranscriptionTimedOutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Transcription provider did not answer within ${timeoutMs}ms`)
    this.name = 'TranscriptionTimedOutError'
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
