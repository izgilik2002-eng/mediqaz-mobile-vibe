import { describe, expect, test } from 'bun:test'

import { apiErrorCodeSchema, apiErrorSchema } from './index'

describe('api error contract', () => {
  test('carries a code the client can translate and a message it can fall back to', () => {
    const parsed = apiErrorSchema.parse({
      error: { code: 'APPOINTMENT_ALREADY_FINISHED', message: 'Appointment is already finished' },
    })
    expect(parsed.error.code).toBe('APPOINTMENT_ALREADY_FINISHED')
    expect(parsed.error.params).toBeUndefined()
  })

  test('accepts string substitution params and rejects non-string values', () => {
    expect(
      apiErrorSchema.parse({
        error: {
          code: 'AUTH_PROVIDER_UNAVAILABLE',
          message: 'Google Sign-In is temporarily unavailable',
          params: { provider: 'Google' },
        },
      }).error.params,
    ).toEqual({ provider: 'Google' })

    expect(() =>
      apiErrorSchema.parse({
        error: { code: 'RATE_LIMITED', message: 'Too many requests', params: { retryAfter: 30 } },
      }),
    ).toThrow()
  })

  test('keeps the generic codes so old app builds still get a meaningful message', () => {
    for (const code of ['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'] as const) {
      expect(apiErrorCodeSchema.parse(code)).toBe(code)
    }
  })

  test('rejects codes outside the enum so the backend cannot invent one silently', () => {
    expect(() => apiErrorCodeSchema.parse('SOMETHING_NEW')).toThrow()
    expect(() =>
      apiErrorSchema.parse({ error: { code: 'SOMETHING_NEW', message: 'nope' } }),
    ).toThrow()
  })
})
