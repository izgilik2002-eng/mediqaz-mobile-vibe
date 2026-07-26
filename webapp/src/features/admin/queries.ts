import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminUsersQuery, UserRole } from '@mediqaz/contracts'

import { useAuth } from '@/features/auth'
import {
  getAdminDashboard,
  getAdminUsers,
  getPendingApprovals,
  updateAdminUserApproval,
  updateAdminUserRole,
} from './api'

const adminQueryKeys = {
  all: ['session', 'admin'] as const,
  dashboard: () => [...adminQueryKeys.all, 'dashboard'] as const,
  users: (query: AdminUsersQuery) => [...adminQueryKeys.all, 'users', query] as const,
  pendingApprovals: () => [...adminQueryKeys.all, 'approvals', 'pending'] as const,
}

export function useAdminDashboardQuery() {
  const auth = useAuth()
  return useQuery({
    queryKey: adminQueryKeys.dashboard(),
    queryFn: () => getAdminDashboard(auth.transport),
  })
}

export function useAdminUsersQuery(query: AdminUsersQuery) {
  const auth = useAuth()
  return useQuery({
    queryKey: adminQueryKeys.users(query),
    queryFn: () => getAdminUsers(auth.transport, query),
  })
}

export function useUpdateAdminUserRoleMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ role, userId }: { role: UserRole; userId: string }) =>
      updateAdminUserRole(auth.transport, userId, { role }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.dashboard() }),
        queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.all, 'users'] }),
      ])
    },
  })
}

export function usePendingApprovalsQuery() {
  const auth = useAuth()
  return useQuery({
    queryKey: adminQueryKeys.pendingApprovals(),
    queryFn: () => getPendingApprovals(auth.transport),
  })
}

export function useUpdateAdminUserApprovalMutation() {
  const auth = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ isApproved, userId }: { isApproved: boolean; userId: string }) =>
      updateAdminUserApproval(auth.transport, userId, { isApproved }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminQueryKeys.pendingApprovals() }),
        queryClient.invalidateQueries({ queryKey: [...adminQueryKeys.all, 'users'] }),
      ])
    },
  })
}
