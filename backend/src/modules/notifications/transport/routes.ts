import {
  apiErrorSchema,
  pushMutationResponseSchema,
  registerPushTokenRequestSchema,
  testPushNotificationRequestSchema,
  testPushNotificationResponseSchema,
  unregisterPushTokenRequestSchema,
} from '@mediqaz/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'

import { AppError, errorResponse } from '../../../http/errors'
import type { AuthenticatedPrincipal } from '../../auth'
import type { NotificationService } from '../application/notification-service'

type AuthenticateAccessToken = (
  accessToken: string | undefined,
) => Promise<AuthenticatedPrincipal>

const errorResponseContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const mutationResponseContent = {
  'application/json': {
    schema: pushMutationResponseSchema,
  },
}

const registerPushTokenRoute = createRoute({
  method: 'post',
  path: '/push-token',
  request: {
    body: {
      content: {
        'application/json': {
          schema: registerPushTokenRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: mutationResponseContent,
      description: 'Registered Expo push token for the current user',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid access token',
    },
    403: {
      content: errorResponseContent,
      description: 'Invalid installation authority',
    },
    409: {
      content: errorResponseContent,
      description: 'A newer push installation mutation already exists',
    },
  },
})

const unregisterPushTokenRoute = createRoute({
  method: 'post',
  path: '/push-token/unregister',
  request: {
    body: {
      content: {
        'application/json': {
          schema: unregisterPushTokenRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: mutationResponseContent,
      description: 'Unregistered one or all Expo push tokens for the current user',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid access token',
    },
    403: {
      content: errorResponseContent,
      description: 'Invalid installation authority',
    },
  },
})

const testPushRoute = createRoute({
  method: 'post',
  path: '/test-push',
  request: {
    body: {
      content: {
        'application/json': {
          schema: testPushNotificationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: testPushNotificationResponseSchema,
        },
      },
      description: 'Queued a test push notification for the current user',
    },
    400: {
      content: errorResponseContent,
      description: 'Invalid payload',
    },
    401: {
      content: errorResponseContent,
      description: 'Invalid access token',
    },
    409: {
      content: errorResponseContent,
      description: 'The current user has no active push token',
    },
    404: {
      content: errorResponseContent,
      description: 'Test push endpoint is disabled',
    },
    429: {
      content: errorResponseContent,
      description: 'Test push quota exceeded',
    },
  },
})

export function createNotificationRoutes(input: {
  authenticateAccessToken: AuthenticateAccessToken
  service: NotificationService
  testPushEnabled: boolean
}) {
  const routes = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          errorResponse('VALIDATION_ERROR', 'Invalid request payload', result.error.issues),
          400,
        )
      }
    },
  })

  routes.openapi(registerPushTokenRoute, async (c) => {
    const accessToken = bearerToken(c)
    const principal = await input.authenticateAccessToken(accessToken)
    const result = await input.service.registerToken(
      principal.id,
      principal.sessionId,
      c.req.valid('json'),
    )
    if (result === 'inactive-session') {
      throw new AppError(401, 'UNAUTHORIZED', 'Сессия истекла. Войдите заново.')
    }
    if (result === 'forbidden') {
      throw new AppError(403, 'PUSH_INSTALLATION_REJECTED', 'Не удалось подтвердить это устройство. Попробуйте ещё раз.')
    }
    if (result === 'stale') {
      throw new AppError(409, 'PUSH_REGISTRATION_STALE', 'Уведомления уже настроены на другом устройстве.')
    }
    return c.json({ applied: true as const, ok: true as const }, 200)
  })

  routes.openapi(unregisterPushTokenRoute, async (c) => {
    const principal = await currentPrincipal(c, input.authenticateAccessToken)
    const result = await input.service.unregisterToken(
      principal.id,
      principal.sessionId,
      c.req.valid('json'),
    )
    if (result === 'inactive-session') {
      throw new AppError(401, 'UNAUTHORIZED', 'Сессия истекла. Войдите заново.')
    }
    if (result === 'forbidden') {
      throw new AppError(403, 'PUSH_INSTALLATION_REJECTED', 'Не удалось подтвердить это устройство. Попробуйте ещё раз.')
    }
    return c.json({ applied: result === 'applied', ok: true as const }, 200)
  })

  routes.openapi(testPushRoute, async (c) => {
    if (!input.testPushEnabled) {
      throw new AppError(404, 'NOT_FOUND', 'This endpoint is disabled')
    }

    const userId = await currentUserId(c, input.authenticateAccessToken)

    if (!(await input.service.hasActiveToken(userId))) {
      throw new AppError(409, 'PUSH_TOKEN_MISSING', 'Синхронизация с телефоном недоступна. Попробуйте позже.')
    }

    const queued = await input.service.sendTestPush(userId, c.req.valid('json'))
    if (!queued.created) {
      throw new AppError(429, 'RATE_LIMITED', 'Слишком много попыток. Подождите немного.')
    }

    return c.json({ ok: true as const, outboxId: queued.id }, 200)
  })

  return routes
}

async function currentUserId(c: Context, authenticateAccessToken: AuthenticateAccessToken) {
  return (await currentPrincipal(c, authenticateAccessToken)).id
}

async function currentPrincipal(c: Context, authenticateAccessToken: AuthenticateAccessToken) {
  return authenticateAccessToken(bearerToken(c))
}

function bearerToken(c: Context) {
  const authorization = c.req.header('authorization')
  if (!authorization?.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}
