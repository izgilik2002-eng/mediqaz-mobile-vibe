import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import { createBackgroundTasks, type TaskDeferrer } from './background-tasks'
import type { DbClient } from './db'
import { disabledEmailDelivery, type EmailDelivery } from './email/service'
import type { AppEnv } from './env'
import { errorResponse, handleError, validationErrorHook } from './http/errors'
import { createIngressSecurity } from './http/security'
import { createAuthModule, type AuthHttpEnv } from './modules/auth'
import {
  createConsultationsModule,
  type AppointmentStore,
  type AudioTranscriber,
  type CompletionClient,
  type TranscriptionGrantIssuer,
} from './modules/consultations'
import { createNotificationsModule } from './modules/notifications'
import { createUsersModule } from './modules/users'

type CreateAppOptions = {
  backgroundTasks?: TaskDeferrer
  emailDelivery?: EmailDelivery
  env: AppEnv
  prisma: DbClient
  /** Overridable so tests exercise routing without reaching real providers. */
  appointments?: AppointmentStore
  audioTranscriber?: AudioTranscriber
  completions?: CompletionClient
  transcriptionGrants?: TranscriptionGrantIssuer
}

export function createApp({
  appointments,
  audioTranscriber,
  backgroundTasks = createBackgroundTasks(),
  completions,
  emailDelivery = disabledEmailDelivery,
  env,
  prisma,
  transcriptionGrants,
}: CreateAppOptions) {
  const notifications = createNotificationsModule({ db: prisma, env })
  const auth = createAuthModule({
    backgroundTasks,
    db: prisma,
    emailDelivery,
    env,
    logoutCleanup: notifications.logoutCleanup,
  })
  const users = createUsersModule({
    db: prisma,
    requireAdmin: auth.requireAdmin,
    requireAuth: auth.requireAuth,
  })
  const consultations = createConsultationsModule({
    appointments,
    audioTranscriber,
    completions,
    db: prisma,
    env,
    transcriptionGrants,
  })
  const app = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })

  app.use(secureHeaders())
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return env.CORS_ORIGINS[0] ?? null
        return env.CORS_ORIGINS.includes(origin) ? origin : null
      },
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      maxAge: 600,
    }),
  )
  const publicWriteSecurity = {
    bodyLimitBytes: env.AUTH_BODY_LIMIT_BYTES,
    rateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    trustProxy: env.TRUST_PROXY,
    trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
  }
  for (const middleware of createIngressSecurity(publicWriteSecurity)) {
    app.use('/api/auth/*', middleware)
  }
  for (const middleware of createIngressSecurity(publicWriteSecurity)) {
    app.use('/api/users/*', middleware)
    app.use('/api/admin/*', middleware)
  }
  // A recording upload is raw audio, not JSON, and needs a much larger body
  // limit than every other consultation route. The two groups are registered
  // on disjoint paths (not a shared '/api/consultations/*' wildcard) so a
  // large audio upload is never re-clamped by the smaller JSON limit.
  const consultationJsonSecurity = {
    ...publicWriteSecurity,
    bodyLimitBytes: env.CONSULTATION_BODY_LIMIT_BYTES,
    rateLimitMax: env.CONSULTATION_RATE_LIMIT_MAX,
    rateLimitWindowSeconds: env.CONSULTATION_RATE_LIMIT_WINDOW_SECONDS,
  }
  for (const middleware of createIngressSecurity(consultationJsonSecurity)) {
    app.use('/api/consultations/transcription-token', middleware)
    app.use('/api/consultations/appointments', middleware)
    app.use('/api/consultations/appointments/:appointmentId', middleware)
    app.use('/api/consultations/appointments/:appointmentId/status', middleware)
    app.use('/api/consultations/appointments/:appointmentId/med-card', middleware)
    app.use('/api/consultations/questions', middleware)
  }
  for (const middleware of createIngressSecurity({
    ...consultationJsonSecurity,
    bodyLimitBytes: env.CONSULTATION_AUDIO_BODY_LIMIT_BYTES,
  })) {
    app.use('/api/consultations/appointments/:appointmentId/audio', middleware)
  }
  app.get('/', (c) => {
    return c.json({
      name: 'mediqaz backend',
      status: 'ok',
    })
  })

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
    })
  })

  app.get('/health/live', (c) => {
    return c.json({
      status: 'ok',
    })
  })

  app.get('/health/ready', async (c) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return c.json({ status: 'ok' }, 200)
    } catch {
      return c.json({ status: 'unavailable' }, 503)
    }
  })

  app.route('/api/auth', auth.routes)
  app.route('/api/users', users.userRoutes)
  app.route('/api/admin', users.adminRoutes)
  app.route('/api/notifications', notifications.createRoutes(auth.authenticateAccessToken))
  app.route('/api/consultations', consultations.createRoutes(auth.authenticateAccessToken))

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'mediqaz API', version: '1.0.0' },
  })
  app.notFound((c) => c.json(errorResponse('NOT_FOUND', 'Route not found'), 404))
  app.onError(handleError)
  return app
}

export type AppType = ReturnType<typeof createApp>
