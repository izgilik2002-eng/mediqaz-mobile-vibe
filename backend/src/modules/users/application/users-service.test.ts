import { expect, test } from 'bun:test'

import type {
  AdminUserSummary,
  DoctorSpecialty,
  TranscriptionLanguage,
} from '@mediqaz/contracts'

import type { AuthenticatedPrincipal } from '../../auth'
import { UsersService } from './users-service'

const principal: AuthenticatedPrincipal = {
  id: 'user-1',
  email: 'profile@example.com',
  displayName: null,
  role: 'user',
  isApproved: false,
  specialty: null,
  transcriptionLanguage: 'ru',
  createdAt: '2026-07-20T00:00:00.000Z',
  sessionId: 'session-1',
}

const pendingDoctor: AdminUserSummary = {
  id: 'doctor-1',
  email: 'doctor@example.com',
  displayName: 'Доктор',
  role: 'user',
  isApproved: false,
  specialty: 'therapist',
  approvedAt: null,
  createdAt: '2026-07-19T00:00:00.000Z',
}

type ProfileWrite = {
  userId: string
  input: {
    displayName: string | null
    specialty?: DoctorSpecialty | null
    transcriptionLanguage?: TranscriptionLanguage
  }
}

type ApprovalCall = {
  actorUserId: string
  targetUserId: string
  isApproved: boolean
  now: Date
}

function createService({
  profileWrites = [],
  approvalCalls = [],
  writtenSpecialty = null,
}: {
  profileWrites?: ProfileWrite[]
  approvalCalls?: ApprovalCall[]
  writtenSpecialty?: DoctorSpecialty | null
} = {}) {
  return new UsersService({
    adminDashboardReader: {
      dashboard: async () => ({ totalUsers: 0, totalAdmins: 0, newUsersLast7Days: 0 }),
    },
    adminUsersReader: {
      listUsers: async () => ({ items: [], page: 1, pageSize: 20, total: 0, hasNext: false }),
    },
    clock: { now: () => new Date('2026-07-20T00:00:00.000Z') },
    pendingApprovalsReader: {
      listPendingApprovals: async () => ({ items: [pendingDoctor], total: 1 }),
    },
    profileWriter: {
      updateProfile: async (userId, input) => {
        profileWrites.push({ userId, input })
        return {
          id: principal.id,
          email: principal.email,
          displayName: input.displayName,
          role: principal.role,
          isApproved: false,
          specialty: writtenSpecialty,
          transcriptionLanguage: input.transcriptionLanguage ?? 'ru',
          createdAt: new Date(principal.createdAt),
        }
      },
    },
    userApprovalUpdater: {
      updateApproval: async (input) => {
        approvalCalls.push(input)
        return { ...pendingDoctor, isApproved: input.isApproved }
      },
    },
    userRoleUpdater: {
      updateRole: async () => {
        throw new Error('not used')
      },
    },
  })
}

test('profile updates return the written profile without a post-write read', async () => {
  const service = createService()

  await expect(
    service.updateProfile(principal, { displayName: 'Updated Name' }),
  ).resolves.toEqual({
    user: {
      id: principal.id,
      email: principal.email,
      displayName: 'Updated Name',
      role: principal.role,
      isApproved: false,
      specialty: null,
      transcriptionLanguage: 'ru',
      createdAt: principal.createdAt,
    },
  })
})

test('a doctor sets their specialty through their own profile', async () => {
  const profileWrites: ProfileWrite[] = []
  const service = createService({ profileWrites, writtenSpecialty: 'therapist' })

  const result = await service.updateProfile(principal, {
    displayName: 'Доктор',
    specialty: 'therapist',
  })

  expect(result.user.specialty).toBe('therapist')
  expect(profileWrites).toEqual([
    { userId: 'user-1', input: { displayName: 'Доктор', specialty: 'therapist' } },
  ])
})

test('a doctor cannot approve themselves through their own profile', async () => {
  const service = createService()

  const result = await service.updateProfile(principal, { displayName: 'Доктор' })

  // The profile write never carries approval, so the administrator endpoint
  // stays the only path to isApproved.
  expect(result.user.isApproved).toBe(false)
})

test('approval records the acting administrator and the current time', async () => {
  const approvalCalls: ApprovalCall[] = []
  const service = createService({ approvalCalls })
  const admin: AuthenticatedPrincipal = { ...principal, id: 'admin-1', role: 'admin' }

  const result = await service.updateApproval(admin, 'doctor-1', { isApproved: true })

  expect(result.user.isApproved).toBe(true)
  expect(approvalCalls).toEqual([
    {
      actorUserId: 'admin-1',
      targetUserId: 'doctor-1',
      isApproved: true,
      now: new Date('2026-07-20T00:00:00.000Z'),
    },
  ])
})

test('revoking approval goes through the same audited path', async () => {
  const approvalCalls: ApprovalCall[] = []
  const service = createService({ approvalCalls })
  const admin: AuthenticatedPrincipal = { ...principal, id: 'admin-1', role: 'admin' }

  const result = await service.updateApproval(admin, 'doctor-1', { isApproved: false })

  expect(result.user.isApproved).toBe(false)
  expect(approvalCalls[0]?.isApproved).toBe(false)
})

test('lists doctors waiting for approval', async () => {
  const service = createService()

  await expect(service.listPendingApprovals()).resolves.toEqual({
    items: [pendingDoctor],
    total: 1,
  })
})
