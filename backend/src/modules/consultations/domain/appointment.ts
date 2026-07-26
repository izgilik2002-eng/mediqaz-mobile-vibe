import type { AppointmentStatus } from '@mediqaz/contracts'

import { ConsultationFailure } from './errors'

/**
 * Statuses the doctor's device owns. Recording, uploading and transcription all
 * happen on the device, so it reports those; everything from generation onwards
 * is decided by the backend and cannot be claimed by a client.
 */
const CLIENT_REPORTABLE_STATUSES = ['recording', 'processing', 'transcribing'] as const

export type ClientReportableStatus = (typeof CLIENT_REPORTABLE_STATUSES)[number]

const TERMINAL_STATUSES: AppointmentStatus[] = ['completed', 'failed']

export function isClientReportableStatus(
  status: AppointmentStatus,
): status is ClientReportableStatus {
  return (CLIENT_REPORTABLE_STATUSES as readonly AppointmentStatus[]).includes(status)
}

/**
 * A finished consultation is a medical record, so progress reports arriving
 * late must not reopen or overwrite it.
 */
export function assertMayReportProgress(current: AppointmentStatus) {
  if (TERMINAL_STATUSES.includes(current)) {
    throw new ConsultationFailure(
      'appointment_already_finished',
      'This consultation is already finished',
    )
  }
}

/** A transcript may only be submitted once, for the same reason. */
export function assertMayGenerate(current: AppointmentStatus) {
  if (TERMINAL_STATUSES.includes(current)) {
    throw new ConsultationFailure(
      'appointment_already_finished',
      'This consultation is already finished',
    )
  }
}
