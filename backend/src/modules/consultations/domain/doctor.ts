import type { DoctorSpecialty } from '@mediqaz/contracts'

import { ConsultationFailure } from './errors'

/** What the consultation rules need to know about the acting doctor. */
export type ConsultationDoctor = {
  id: string
  isApproved: boolean
  specialty: DoctorSpecialty | null
}

/**
 * Recording and med-card generation cost money on every call and produce
 * medical records, so both are refused until an administrator has cleared the
 * account. Registration alone is never enough.
 */
export function assertMayRecord(doctor: ConsultationDoctor) {
  if (!doctor.isApproved) {
    throw new ConsultationFailure(
      'not_approved',
      'This account has not been approved for consultations yet',
    )
  }
}

/**
 * The med-card prompt is specialty-specific, so a doctor who has not chosen one
 * is asked to complete their profile instead of silently getting a default.
 */
export function requireSpecialty(doctor: ConsultationDoctor): DoctorSpecialty {
  assertMayRecord(doctor)

  if (!doctor.specialty) {
    throw new ConsultationFailure(
      'specialty_required',
      'Set your specialty in your profile before generating a med card',
    )
  }

  return doctor.specialty
}
