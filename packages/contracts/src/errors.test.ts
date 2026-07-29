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

  test('apiErrorCodeSchema stays closed so the backend cannot invent a code when constructing a response', () => {
    expect(() => apiErrorCodeSchema.parse('SOMETHING_NEW')).toThrow()
  })

  test('apiErrorSchema accepts a code it does not recognize, so a server ahead of an older client still parses', () => {
    const parsed = apiErrorSchema.parse({
      error: { code: 'SOMETHING_NEW', message: 'A message this client build has never seen' },
    })
    expect(parsed.error.code).toBe('SOMETHING_NEW')
    expect(parsed.error.message).toBe('A message this client build has never seen')
  })
})
