import { describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type {
  AppointmentStore,
  AudioTranscriber,
  CompletionClient,
  TranscriptionGrantIssuer,
} from './application/ports'

const env: AppEnv = {
  PORT: 3000,
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/mediqaz',
  JWT_SECRET: 'test-route-secret-at-least-thirty-two-chars-123',
  CORS_ORIGINS: ['https://web.example.com'],
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_DAYS: 30,
  REFRESH_REUSE_GRACE_SECONDS: 10,
  SESSION_ABSOLUTE_TTL_DAYS: 90,
  SESSION_RETENTION_DAYS: 7,
  AUTH_BODY_LIMIT_BYTES: 64 * 1024,
  AUTH_RATE_LIMIT_MAX: 60,
  AUTH_RATE_LIMIT_WINDOW_SECONDS: 60,
  SHUTDOWN_GRACE_SECONDS: 20,
  TRUST_PROXY: false,
  COOKIE_SECURE: false,
  ENABLE_TEST_PUSH: false,
  SPACES_UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  SPACES_UPLOAD_URL_TTL_SECONDS: 900,
  SPACES_DOWNLOAD_URL_TTL_SECONDS: 300,
  SPACES_PUBLIC_CACHE_CONTROL: 'public, max-age=31536000, immutable',
  APPLE_AUTH_JWKS_TIMEOUT_MS: 5000,
  GOOGLE_AUTH_CLIENT_IDS: [],
  TRANSCRIPTION_GRANT_TTL_SECONDS: 300,
  GROQ_MAX_CONCURRENT: 1,
  CONSULTATION_BODY_LIMIT_BYTES: 512 * 1024,
  CONSULTATION_AUDIO_BODY_LIMIT_BYTES: 25 * 1024 * 1024,
  CONSULTATION_RATE_LIMIT_MAX: 60,
  CONSULTATION_RATE_LIMIT_WINDOW_SECONDS: 60,
  MIS_DELIVERY_TTL_HOURS: 24,
  TRANSCRIPTION_MAX_AUDIO_SECONDS: 600,
} as AppEnv

const medCardJson = JSON.stringify({
  тип_приема: 'Первичный',
  жалобы: { текст: 'Боль в горле', цитата: 'горло болит' },
  анамнез: { текст: 'Три дня', цитата: 'три дня' },
  объективно: { текст: 'Зев гиперемирован', цитата: 'зев красный' },
  диагноз: { текст: 'Острый фарингит', мкб10: 'J02.9', цитата: 'фарингит' },
  назначения: { текст: 'Полоскание', цитата: 'полоскать' },
  рекомендации: { текст: 'Питьё', цитата: 'пить' },
  следующий_прием: { текст: 'Через 5 дней', цитата: 'через пять' },
})

const summary = {
  id: '019c0000-0000-7000-8000-000000000001',
  status: 'recording' as const,
  specialty: 'therapist' as const,
  patientName: null,
  durationSeconds: null,
  createdAt: '2026-07-27T10:00:00.000Z',
  completedAt: null,
}

const appointmentStore: AppointmentStore = {
  start: async () => summary,
  updateStatus: async ({ status }) => ({ ...summary, status }),
  markGenerating: async () => ({ ...summary, status: 'generating' }),
  markCompleted: async () => ({ ...summary, status: 'completed' }),
  markFailed: async () => ({ ...summary, status: 'failed' }),
  statusFor: async () => 'recording',
  listForDoctor: async () => ({ items: [summary], total: 1 }),
  findForDoctor: async () => ({ ...summary, transcript: null, medCard: null }),
}

const workingAudioTranscriber: AudioTranscriber = {
  transcribe: async () => ({ transcript: 'приём', durationSeconds: 120 }),
}

function createTestApp(overrides: {
  appointments?: AppointmentStore
  audioTranscriber?: AudioTranscriber
  completions?: CompletionClient
  transcriptionGrants?: TranscriptionGrantIssuer
  env?: Partial<AppEnv>
} = {}) {
  const transcriber = overrides.audioTranscriber ?? workingAudioTranscriber
  return createApp({
    env: { ...env, ...overrides.env },
    prisma: {} as DbClient,
    appointments: overrides.appointments ?? appointmentStore,
    transcription: {
      batchTranscriberFor: () => transcriber,
      streamingParamsFor: () => ({ model: 'nova-2', language: 'ru' }),
    },
    completions: overrides.completions ?? { complete: async () => medCardJson },
    transcriptionGrants:
      overrides.transcriptionGrants ??
      { issue: async ({ ttlSeconds }) => ({ accessToken: 'ephemeral', expiresIn: ttlSeconds }) },
  })
}

const medCardPath = `/api/consultations/appointments/${summary.id}/med-card`
const audioPath = `/api/consultations/appointments/${summary.id}/audio`

const jsonHeaders = { 'Content-Type': 'application/json' }

describe('consultation routes', () => {
  test('rejects an unauthenticated transcription token request before reaching the provider', async () => {
    let issued = 0
    const app = createTestApp({
      transcriptionGrants: {
        issue: async () => {
          issued += 1
          return { accessToken: 'ephemeral', expiresIn: 300 }
        },
      },
    })

    const response = await app.request('/api/consultations/transcription-token', {
      method: 'POST',
    })

    expect(response.status).toBe(401)
    expect(issued).toBe(0)
  })

  test('rejects an unauthenticated med-card request before reaching the model', async () => {
    let calls = 0
    const app = createTestApp({
      completions: {
        complete: async () => {
          calls += 1
          return medCardJson
        },
      },
    })

    const response = await app.request(medCardPath, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ transcript: 'приём' }),
    })

    expect(response.status).toBe(401)
    expect(calls).toBe(0)
  })

  test('limits consultation bodies before the model is called', async () => {
    let calls = 0
    const app = createTestApp({
      env: { CONSULTATION_BODY_LIMIT_BYTES: 64 },
      completions: {
        complete: async () => {
          calls += 1
          return medCardJson
        },
      },
    })

    const response = await app.request(medCardPath, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ transcript: 'а'.repeat(4_000) }),
    })

    expect(response.status).toBe(413)
    expect(calls).toBe(0)
  })

  test('accepts a transcript far larger than the auth body limit', async () => {
    const app = createTestApp()

    const response = await app.request(medCardPath, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ transcript: 'а'.repeat(50_000) }),
    })

    expect(response.status).not.toBe(413)
  })

  test('has an independent bounded request rate', async () => {
    const app = createTestApp({ env: { CONSULTATION_RATE_LIMIT_MAX: 1 } })
    const request = () =>
      app.request(medCardPath, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ transcript: 'приём' }),
      })

    await request()
    const second = await request()

    expect(second.status).toBe(429)
  })

  test('rejects an unauthenticated audio upload before reaching the transcriber', async () => {
    let calls = 0
    const app = createTestApp({
      audioTranscriber: {
        transcribe: async () => {
          calls += 1
          return { transcript: 'приём', durationSeconds: 10 }
        },
      },
    })

    const response = await app.request(audioPath, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/mp4' },
      body: new Uint8Array([1, 2, 3]),
    })

    expect(response.status).toBe(401)
    expect(calls).toBe(0)
  })

  test('gives audio uploads their own body limit, larger than the JSON consultation routes', async () => {
    // Smaller than the upload below, so a shared limit would reject it here too.
    const app = createTestApp({ env: { CONSULTATION_BODY_LIMIT_BYTES: 64 } })

    const response = await app.request(audioPath, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/mp4' },
      body: new Uint8Array(4_000),
    })

    expect(response.status).not.toBe(413)
  })

  test('still bounds audio uploads at their own configured limit', async () => {
    const app = createTestApp({ env: { CONSULTATION_AUDIO_BODY_LIMIT_BYTES: 64 } })

    const response = await app.request(audioPath, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/mp4' },
      body: new Uint8Array(4_000),
    })

    expect(response.status).toBe(413)
  })

  test('mounts the consultation routes', async () => {
    const app = createTestApp()
    const routes = app.routes.filter((route) => route.path.includes('consultations'))

    expect(routes.length).toBeGreaterThan(0)
  })
})

describe('consultation provider configuration', () => {
  test('refuses to compose a production API without provider keys', () => {
    expect(() =>
      createApp({
        env: { ...env, NODE_ENV: 'production' },
        prisma: {} as DbClient,
      }),
    ).toThrow('required to serve consultations in production')
  })

  test('composes without provider keys outside production so local work is unblocked', () => {
    expect(() => createApp({ env, prisma: {} as DbClient })).not.toThrow()
  })

  test('accepts a production API once both provider keys are set', () => {
    expect(() =>
      createApp({
        env: {
          ...env,
          NODE_ENV: 'production',
          DEEPGRAM_API_KEY: 'deepgram-key',
          GROQ_API_KEY: 'groq-key',
        },
        prisma: {} as DbClient,
      }),
    ).not.toThrow()
  })
})
