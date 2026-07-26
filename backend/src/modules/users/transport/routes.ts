import {
  adminDashboardResponseSchema,
  adminPendingApprovalsResponseSchema,
  adminUserParamsSchema,
  adminUsersQuerySchema,
  adminUsersResponseSchema,
  apiErrorSchema,
  updateProfileRequestSchema,
  updateProfileResponseSchema,
  updateUserApprovalRequestSchema,
  updateUserApprovalResponseSchema,
  updateUserRoleRequestSchema,
  updateUserRoleResponseSchema,
} from '@mediqaz/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { UsersService } from '../application/users-service'
import { executeUsers } from './errors'

const errorContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const updateProfileRoute = createRoute({
  method: 'patch',
  path: '/me',
  request: {
    body: {
      content: {
        'application/json': {
          schema: updateProfileRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: updateProfileResponseSchema } },
      description: 'Updated current user profile',
    },
    400: { content: errorContent, description: 'Invalid payload' },
    401: { content: errorContent, description: 'Authentication required' },
  },
})

const dashboardRoute = createRoute({
  method: 'get',
  path: '/dashboard',
  responses: {
    200: {
      content: { 'application/json': { schema: adminDashboardResponseSchema } },
      description: 'Administrator dashboard metrics',
    },
    401: { content: errorContent, description: 'Authentication required' },
    403: { content: errorContent, description: 'Administrator access required' },
  },
})

const listUsersRoute = createRoute({
  method: 'get',
  path: '/users',
  request: {
    query: adminUsersQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: adminUsersResponseSchema } },
      description: 'Paginated users',
    },
    400: { content: errorContent, description: 'Invalid query' },
    401: { content: errorContent, description: 'Authentication required' },
    403: { content: errorContent, description: 'Administrator access required' },
  },
})

const updateRoleRoute = createRoute({
  method: 'patch',
  path: '/users/{userId}/role',
  request: {
    params: adminUserParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: updateUserRoleRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: updateUserRoleResponseSchema } },
      description: 'Updated user role',
    },
    400: { content: errorContent, description: 'Invalid payload' },
    401: { content: errorContent, description: 'Authentication required' },
    403: { content: errorContent, description: 'Administrator access required' },
    404: { content: errorContent, description: 'User not found' },
    409: { content: errorContent, description: 'Role update conflict' },
  },
})

const pendingApprovalsRoute = createRoute({
  method: 'get',
  path: '/approvals/pending',
  responses: {
    200: {
      content: { 'application/json': { schema: adminPendingApprovalsResponseSchema } },
      description: 'Doctors waiting for approval',
    },
    401: { content: errorContent, description: 'Authentication required' },
    403: { content: errorContent, description: 'Administrator access required' },
  },
})

const updateApprovalRoute = createRoute({
  method: 'patch',
  path: '/users/{userId}/approval',
  request: {
    params: adminUserParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: updateUserApprovalRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: updateUserApprovalResponseSchema } },
      description: 'Updated consultation approval',
    },
    400: { content: errorContent, description: 'Invalid payload' },
    401: { content: errorContent, description: 'Authentication required' },
    403: { content: errorContent, description: 'Administrator access required' },
    404: { content: errorContent, description: 'User not found' },
  },
})

type CreateUsersRoutesOptions = {
  requireAdmin: MiddlewareHandler<AuthHttpEnv>
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: UsersService
}

export function createUsersRoutes({
  requireAdmin,
  requireAuth,
  service,
}: CreateUsersRoutesOptions) {
  const userRoutes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  const adminRoutes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })

  userRoutes.use('*', requireAuth)
  userRoutes.openapi(updateProfileRoute, async (c) => {
    const result = await executeUsers(() =>
      service.updateProfile(c.var.user, c.req.valid('json')),
    )
    return c.json(result, 200)
  })

  adminRoutes.use('*', requireAuth)
  adminRoutes.use('*', requireAdmin)
  adminRoutes.openapi(dashboardRoute, async (c) => c.json(await service.dashboard(), 200))
  adminRoutes.openapi(listUsersRoute, async (c) => {
    return c.json(await service.listUsers(c.req.valid('query')), 200)
  })
  adminRoutes.openapi(pendingApprovalsRoute, async (c) =>
    c.json(await service.listPendingApprovals(), 200),
  )
  adminRoutes.openapi(updateApprovalRoute, async (c) => {
    const result = await executeUsers(() =>
      service.updateApproval(
        c.var.user,
        c.req.valid('param').userId,
        c.req.valid('json'),
      ),
    )
    return c.json(result, 200)
  })
  adminRoutes.openapi(updateRoleRoute, async (c) => {
    const result = await executeUsers(() =>
      service.updateRole(
        c.var.user,
        c.req.valid('param').userId,
        c.req.valid('json'),
      ),
    )
    return c.json(result, 200)
  })

  return { adminRoutes, userRoutes }
}
