import {
  medCardSchema,
  type Appointment,
  type AppointmentStatus,
  type AppointmentSummary,
  type DoctorSpecialty,
} from '@mediqaz/contracts'

import type { DbClient } from '../../../db'
import type { AppointmentStore } from '../application/ports'

const summarySelection = {
  id: true,
  status: true,
  specialty: true,
  patientName: true,
  durationSeconds: true,
  createdAt: true,
  completedAt: true,
} as const

export function createPrismaAppointmentStore(db: DbClient): AppointmentStore {
  return {
    async start({ doctorId, specialty, patientName }) {
      return toSummary(
        await db.appointment.create({
          data: { doctorId, specialty, patientName },
          select: summarySelection,
        }),
      )
    },

    async updateStatus({ appointmentId, doctorId, status }) {
      // Scoped by doctor in the write itself so ownership cannot drift between
      // the check and the update.
      const [updated] = await db.appointment.updateManyAndReturn({
        where: { id: appointmentId, doctorId },
        data: { status },
        select: summarySelection,
      })

      return toSummary(updated)
    },

    async markGenerating({ appointmentId, doctorId, transcript, durationSeconds }) {
      const [updated] = await db.appointment.updateManyAndReturn({
        where: { id: appointmentId, doctorId },
        data: {
          status: 'generating',
          transcript,
          ...(durationSeconds === undefined ? {} : { durationSeconds }),
          failureReason: null,
        },
        select: summarySelection,
      })

      return toSummary(updated)
    },

    async markCompleted({ appointmentId, medCard, completedAt }) {
      return toSummary(
        await db.appointment.update({
          where: { id: appointmentId },
          data: { status: 'completed', medCard, completedAt, failureReason: null },
          select: summarySelection,
        }),
      )
    },

    async markFailed({ appointmentId, reason }) {
      return toSummary(
        await db.appointment.update({
          where: { id: appointmentId },
          data: { status: 'failed', failureReason: reason },
          select: summarySelection,
        }),
      )
    },

    async statusFor({ appointmentId, doctorId }) {
      const row = await db.appointment.findFirst({
        where: { id: appointmentId, doctorId },
        select: { status: true },
      })

      return row?.status ?? null
    },

    async listForDoctor(doctorId) {
      const [rows, total] = await Promise.all([
        db.appointment.findMany({
          where: { doctorId },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: summarySelection,
        }),
        db.appointment.count({ where: { doctorId } }),
      ])

      return { items: rows.map(toSummary), total }
    },

    async findForDoctor({ appointmentId, doctorId }) {
      const row = await db.appointment.findFirst({
        where: { id: appointmentId, doctorId },
        select: { ...summarySelection, transcript: true, medCard: true },
      })

      if (!row) return null

      return {
        ...toSummary(row),
        transcript: row.transcript,
        medCard: toMedCard(row.medCard),
      } satisfies Appointment
    },
  }
}

type SummaryRow = {
  id: string
  status: AppointmentStatus
  specialty: DoctorSpecialty
  patientName: string | null
  durationSeconds: number | null
  createdAt: Date
  completedAt: Date | null
}

function toSummary(row: SummaryRow): AppointmentSummary {
  return {
    id: row.id,
    status: row.status,
    specialty: row.specialty,
    patientName: row.patientName,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

/**
 * Stored cards are validated on read: a card written by an older med-card shape
 * is reported as missing rather than served as a malformed medical record.
 */
function toMedCard(value: unknown) {
  if (value === null || value === undefined) return null
  const parsed = medCardSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
