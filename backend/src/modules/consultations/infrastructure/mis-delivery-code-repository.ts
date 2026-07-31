import { randomBytes } from 'node:crypto'

import type { DbClient } from '../../../db'
import type { MisDeliveryCodeStore } from '../application/ports'

/**
 * 32 bytes of entropy. The code is the only barrier between one doctor's
 * delivered med cards and another's — the extension's Supabase key is public by
 * construction — so it has to survive being guessed at by anyone who can call
 * the claim function.
 */
const CODE_BYTES = 32

function generateCode() {
  return randomBytes(CODE_BYTES).toString('base64url')
}

export function createPrismaMisDeliveryCodeStore(db: DbClient): MisDeliveryCodeStore {
  return {
    async ensureFor(doctorId) {
      const existing = await db.user.findUnique({
        where: { id: doctorId },
        select: { misDeliveryCode: true },
      })

      if (existing?.misDeliveryCode) return existing.misDeliveryCode

      // Issued on first read, not on first send: the doctor sets the extension
      // up before ever recording, so the code has to exist before there is any
      // consultation to deliver.
      const updated = await db.user.update({
        where: { id: doctorId },
        data: { misDeliveryCode: generateCode() },
        select: { misDeliveryCode: true },
      })

      return updated.misDeliveryCode as string
    },

    async regenerateFor(doctorId) {
      const updated = await db.user.update({
        where: { id: doctorId },
        data: { misDeliveryCode: generateCode() },
        select: { misDeliveryCode: true },
      })

      return updated.misDeliveryCode as string
    },
  }
}
