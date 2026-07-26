import { describe, expect, spyOn, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { runCronTask } from './cron'

const runtime = {} as BackendRuntime

describe('runCronTask', () => {
  test('runs the noop task', async () => {
    await expect(runCronTask('noop', runtime)).resolves.toBeUndefined()
  })

  test('rejects unknown tasks', async () => {
    await expect(runCronTask('missing', runtime)).rejects.toThrow('Unknown cron task')
  })

  test('deletes expired and revoked auth sessions after the retention window', async () => {
    const sessionCalls: unknown[] = []
    const resetTokenCalls: unknown[] = []
    let pushTokenMaintenanceQueries = 0
    const cleanupRuntime = {
      env: { SESSION_ABSOLUTE_TTL_DAYS: 90, SESSION_RETENTION_DAYS: 7 },
      prisma: {
        $executeRaw: async () => {
          pushTokenMaintenanceQueries += 1
          return 3
        },
        authSession: {
          deleteMany: async (input: unknown) => {
            sessionCalls.push(input)
            return { count: 2 }
          },
        },
        passwordResetToken: {
          deleteMany: async (input: unknown) => {
            resetTokenCalls.push(input)
            return { count: 3 }
          },
        },
      },
    } as unknown as BackendRuntime

    const now = new Date('2026-04-08T12:00:00.000Z')
    await runCronTask('auth:sessions:cleanup', cleanupRuntime, now)

    expect(sessionCalls).toHaveLength(1)
    expect(pushTokenMaintenanceQueries).toBe(2)
    expect(sessionCalls[0]).toMatchObject({
      where: {
        OR: [
          { expiresAt: { lt: expect.any(Date) } },
          { revokedAt: { lt: expect.any(Date) } },
          { createdAt: { lt: new Date('2026-01-01T12:00:00.000Z') } },
        ],
      },
    })
    expect(resetTokenCalls).toEqual([{
      where: { expiresAt: { lt: now } },
    }])
  })

  test('runs session cleanup and terminal redaction in one maintenance task', async () => {
    const calls = {
      cleanup: 0,
      passwordResetCleanup: 0,
      pushTokenMaintenanceQueries: 0,
      terminalRedactionSelection: 0,
    }
    const log = spyOn(console, 'log').mockImplementation(() => {})
    const maintenanceRuntime = {
      env: {
        SESSION_ABSOLUTE_TTL_DAYS: 90,
        SESSION_RETENTION_DAYS: 7,
      },
      prisma: {
        $executeRaw: async () => {
          calls.pushTokenMaintenanceQueries += 1
          return 0
        },
        $queryRaw: async () => [{ dueCount: 0n, oldestDueAt: null }],
        authSession: {
          deleteMany: async () => {
            calls.cleanup += 1
            return { count: 2 }
          },
        },
        passwordResetToken: {
          deleteMany: async () => {
            calls.passwordResetCleanup += 1
            return { count: 0 }
          },
        },
        pushNotificationOutbox: {
          findMany: async () => {
            calls.terminalRedactionSelection += 1
            return []
          },
        },
      },
    } as unknown as BackendRuntime

    try {
      await runCronTask(
        'maintenance:process',
        maintenanceRuntime,
        new Date('2026-07-17T10:00:00.000Z'),
      )

      expect(calls).toEqual({
        cleanup: 1,
        passwordResetCleanup: 1,
        pushTokenMaintenanceQueries: 2,
        terminalRedactionSelection: 1,
      })
      expect(log).toHaveBeenCalledWith(
        'Cron maintenance:process task completed.',
        expect.objectContaining({
          terminalNotificationOutboxesRedacted: 0,
        }),
      )
    } finally {
      log.mockRestore()
    }
  })
})
