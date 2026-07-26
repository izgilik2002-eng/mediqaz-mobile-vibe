import type {
  AdminDashboardResponse,
  AdminPendingApprovalsResponse,
  AdminUserSummary,
  AdminUsersQuery,
  AdminUsersResponse,
  DoctorSpecialty,
  UserRole,
} from '@mediqaz/contracts'

export type UserRecord = {
  id: string
  email: string
  displayName: string | null
  role: UserRole
  isApproved: boolean
  specialty: DoctorSpecialty | null
  createdAt: Date
}

export type ProfileWriter = {
  updateProfile(
    userId: string,
    input: { displayName: string | null; specialty?: DoctorSpecialty | null },
  ): Promise<UserRecord>
}

export type AdminDashboardReader = {
  dashboard(createdAfter: Date): Promise<AdminDashboardResponse>
}

export type AdminUsersReader = {
  listUsers(query: AdminUsersQuery): Promise<AdminUsersResponse>
}

export type UserRoleUpdater = {
  updateRole(input: {
    actorUserId: string
    targetUserId: string
    role: UserRole
    now: Date
  }): Promise<AdminUserSummary>
}

/** Administrators clear doctors for consultations, and can revoke that later. */
export type UserApprovalUpdater = {
  updateApproval(input: {
    actorUserId: string
    targetUserId: string
    isApproved: boolean
    now: Date
  }): Promise<AdminUserSummary>
}

export type PendingApprovalsReader = {
  listPendingApprovals(): Promise<AdminPendingApprovalsResponse>
}

export type Clock = {
  now(): Date
}
