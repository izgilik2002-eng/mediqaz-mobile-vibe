import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'AUTH_EMAIL_ALREADY_EXISTS',
  'AUTH_INVALID_PROVIDER_TOKEN',
  'AUTH_PROVIDER_ACCOUNT_ALREADY_LINKED',
  'AUTH_PROVIDER_EMAIL_REQUIRED',
  'AUTH_PROVIDER_NOT_CONFIGURED',
  'AUTH_PROVIDER_UNAVAILABLE',
  'CONSULTATION_PROVIDER_UNAVAILABLE',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'AUTH_PASSWORD_RESET_INVALID',
  'INTERNAL_ERROR',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>
