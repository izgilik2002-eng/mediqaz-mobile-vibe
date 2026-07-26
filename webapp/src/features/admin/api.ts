import {
  adminDashboardResponseSchema,
  adminUsersQuerySchema,
  adminUsersResponseSchema,
  adminPendingApprovalsResponseSchema,
  updateUserApprovalRequestSchema,
  updateUserApprovalResponseSchema,
  updateUserRoleRequestSchema,
  updateUserRoleResponseSchema,
  type AdminUsersQuery,
  type UpdateUserApprovalRequest,
  type UpdateUserRoleRequest,
} from '@mediqaz/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

export function getAdminDashboard(transport: AuthenticatedTransport) {
  return transport.request('/api/admin/dashboard', adminDashboardResponseSchema)
}

export function getAdminUsers(
  transport: AuthenticatedTransport,
  input: AdminUsersQuery,
) {
  const query = adminUsersQuerySchema.parse(input)
  const search = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  })
  if (query.q) search.set('q', query.q)
  return transport.request(`/api/admin/users?${search}`, adminUsersResponseSchema)
}

export function updateAdminUserRole(
  transport: AuthenticatedTransport,
  userId: string,
  input: UpdateUserRoleRequest,
) {
  return transport.request(
    `/api/admin/users/${encodeURIComponent(userId)}/role`,
    updateUserRoleResponseSchema,
    {
      method: 'PATCH',
      body: updateUserRoleRequestSchema.parse(input),
    },
  )
}

export function getPendingApprovals(transport: AuthenticatedTransport) {
  return transport.request('/api/admin/approvals/pending', adminPendingApprovalsResponseSchema)
}

export function updateAdminUserApproval(
  transport: AuthenticatedTransport,
  userId: string,
  input: UpdateUserApprovalRequest,
) {
  return transport.request(
    `/api/admin/users/${encodeURIComponent(userId)}/approval`,
    updateUserApprovalResponseSchema,
    {
      method: 'PATCH',
      body: updateUserApprovalRequestSchema.parse(input),
    },
  )
}
