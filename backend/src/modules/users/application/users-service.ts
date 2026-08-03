import type {
  AdminUsersQuery,
  UpdateProfileRequest,
  UpdateUserApprovalRequest,
  UpdateUserRoleRequest,
  UserDto,
} from '@mediqaz/contracts'

import type { AuthenticatedPrincipal } from '../../auth'
import type {
  AdminDashboardReader,
  AdminUsersReader,
  Clock,
  PendingApprovalsReader,
  ProfileWriter,
  UserApprovalUpdater,
  UserRecord,
  UserRoleUpdater,
} from './ports'

type UsersServiceDependencies = {
  adminDashboardReader: AdminDashboardReader
  adminUsersReader: AdminUsersReader
  clock: Clock
  pendingApprovalsReader: PendingApprovalsReader
  profileWriter: ProfileWriter
  userApprovalUpdater: UserApprovalUpdater
  userRoleUpdater: UserRoleUpdater
}

export class UsersService {
  constructor(private readonly dependencies: UsersServiceDependencies) {}

  async updateProfile(principal: AuthenticatedPrincipal, input: UpdateProfileRequest) {
    const user = await this.dependencies.profileWriter.updateProfile(principal.id, {
      displayName: input.displayName,
      specialty: input.specialty,
      transcriptionLanguage: input.transcriptionLanguage,
    })
    return {
      user: this.userDto(user),
    }
  }

  dashboard() {
    const createdAfter = new Date(this.dependencies.clock.now().getTime() - 7 * 24 * 60 * 60 * 1000)
    return this.dependencies.adminDashboardReader.dashboard(createdAfter)
  }

  listUsers(query: AdminUsersQuery) {
    return this.dependencies.adminUsersReader.listUsers(query)
  }

  async updateRole(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
    input: UpdateUserRoleRequest,
  ) {
    return {
      user: await this.dependencies.userRoleUpdater.updateRole({
        actorUserId: principal.id,
        targetUserId,
        role: input.role,
        now: this.dependencies.clock.now(),
      }),
    }
  }

  listPendingApprovals() {
    return this.dependencies.pendingApprovalsReader.listPendingApprovals()
  }

  async updateApproval(
    principal: AuthenticatedPrincipal,
    targetUserId: string,
    input: UpdateUserApprovalRequest,
  ) {
    return {
      user: await this.dependencies.userApprovalUpdater.updateApproval({
        actorUserId: principal.id,
        targetUserId,
        isApproved: input.isApproved,
        now: this.dependencies.clock.now(),
      }),
    }
  }

  private userDto(user: UserRecord): UserDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      isApproved: user.isApproved,
      specialty: user.specialty,
      transcriptionLanguage: user.transcriptionLanguage,
      createdAt: user.createdAt.toISOString(),
    }
  }
}
