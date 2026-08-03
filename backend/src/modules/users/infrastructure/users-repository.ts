import type {
  AdminUserSummary,
  AdminUsersQuery,
  DoctorSpecialty,
  UserRole,
} from '@mediqaz/contracts'
import { ADMIN_USERS_MAX_PAGE } from '@mediqaz/contracts'

import {
  acquirePushTokenUserLock,
  acquireUserAuthenticationAuthorityLock,
  acquireUserRoleMutationLock,
  type DbClient,
  userAuthorityTransitionTransactionOptions,
} from '../../../db'
import type {
  AdminDashboardReader,
  AdminUsersReader,
  PendingApprovalsReader,
  ProfileWriter,
  UserApprovalUpdater,
  UserRoleUpdater,
} from '../application/ports'
import { UsersFailure } from '../domain/errors'

const userSummarySelect = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  isApproved: true,
  specialty: true,
  transcriptionLanguage: true,
  approvedAt: true,
  createdAt: true,
} as const

type UsersRepository =
  & ProfileWriter
  & AdminDashboardReader
  & AdminUsersReader
  & UserRoleUpdater
  & UserApprovalUpdater
  & PendingApprovalsReader

export function createPrismaUsersRepository(db: DbClient): UsersRepository {
  return {
    updateProfile(userId, input) {
      return db.user.update({
        where: { id: userId },
        data: {
          displayName: input.displayName,
          ...(input.specialty === undefined ? {} : { specialty: input.specialty }),
          ...(input.transcriptionLanguage === undefined
            ? {}
            : { transcriptionLanguage: input.transcriptionLanguage }),
        },
        select: userSummarySelect,
      })
    },

    async dashboard(createdAfter) {
      const [totalUsers, totalAdmins, newUsersLast7Days] = await db.$transaction([
        db.user.count(),
        db.user.count({ where: { role: 'admin' } }),
        db.user.count({ where: { createdAt: { gte: createdAfter } } }),
      ])
      return { totalUsers, totalAdmins, newUsersLast7Days }
    },

    async listUsers({ page, pageSize, q }: AdminUsersQuery) {
      const where = q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { displayName: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}
      const [total, users] = await db.$transaction([
        db.user.count({ where }),
        db.user.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: userSummarySelect,
        }),
      ])
      return {
        items: users.map(toAdminUserSummary),
        page,
        pageSize,
        total,
        hasNext: page < ADMIN_USERS_MAX_PAGE && page * pageSize < total,
      }
    },

    updateRole(input) {
      return db.$transaction(async (tx) => {
        await acquirePushTokenUserLock(tx, input.targetUserId)
        await acquireUserAuthenticationAuthorityLock(tx, input.targetUserId)
        await acquireUserRoleMutationLock(tx)

        const actor = await tx.user.findUnique({
          where: { id: input.actorUserId },
          select: { id: true, role: true },
        })
        if (actor?.role !== 'admin') {
          throw new UsersFailure('forbidden', 'Administrator access is required')
        }

        const target = await tx.user.findUnique({
          where: { id: input.targetUserId },
          select: userSummarySelect,
        })
        if (!target) {
          throw new UsersFailure('not_found', 'User not found')
        }
        if (target.role === input.role) {
          return toAdminUserSummary(target)
        }
        if (target.id === actor.id && input.role !== 'admin') {
          throw new UsersFailure('self_demotion', 'You cannot remove your own administrator role')
        }

        if (target.role === 'admin' && input.role === 'user') {
          const adminCount = await tx.user.count({ where: { role: 'admin' } })
          if (adminCount <= 1) {
            throw new UsersFailure('last_admin', 'At least one administrator must remain')
          }
        }

        const updated = await tx.user.update({
          where: { id: target.id },
          data: { role: input.role },
          select: userSummarySelect,
        })
        await tx.authSession.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: input.now },
        })
        await tx.pushToken.deleteMany({
          where: { userId: target.id },
        })
        await tx.passwordResetToken.updateMany({
          where: { userId: target.id, usedAt: null },
          data: { usedAt: input.now },
        })
        return toAdminUserSummary(updated)
      }, userAuthorityTransitionTransactionOptions)
    },

    updateApproval(input) {
      return db.$transaction(async (tx) => {
        await acquireUserAuthenticationAuthorityLock(tx, input.targetUserId)

        const actor = await tx.user.findUnique({
          where: { id: input.actorUserId },
          select: { id: true, role: true },
        })
        if (actor?.role !== 'admin') {
          throw new UsersFailure('forbidden', 'Administrator access is required')
        }

        const target = await tx.user.findUnique({
          where: { id: input.targetUserId },
          select: userSummarySelect,
        })
        if (!target) {
          throw new UsersFailure('not_found', 'User not found')
        }
        if (target.isApproved === input.isApproved) {
          return toAdminUserSummary(target)
        }

        const updated = await tx.user.update({
          where: { id: target.id },
          data: {
            isApproved: input.isApproved,
            approvedAt: input.isApproved ? input.now : null,
            approvedByUserId: input.isApproved ? actor.id : null,
          },
          select: userSummarySelect,
        })

        // Revoking access must take effect now, not when the current access
        // token happens to expire, so live sessions are ended.
        if (!input.isApproved) {
          await tx.authSession.updateMany({
            where: { userId: target.id, revokedAt: null },
            data: { revokedAt: input.now },
          })
        }

        return toAdminUserSummary(updated)
      }, userAuthorityTransitionTransactionOptions)
    },

    async listPendingApprovals() {
      const [users, total] = await Promise.all([
        db.user.findMany({
          where: { isApproved: false },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 100,
          select: userSummarySelect,
        }),
        db.user.count({ where: { isApproved: false } }),
      ])

      return { items: users.map(toAdminUserSummary), total }
    },
  }
}

function toAdminUserSummary(user: {
  id: string
  email: string
  displayName: string | null
  role: UserRole
  isApproved: boolean
  specialty: DoctorSpecialty | null
  approvedAt: Date | null
  createdAt: Date
}): AdminUserSummary {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isApproved: user.isApproved,
    specialty: user.specialty,
    approvedAt: user.approvedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }
}
