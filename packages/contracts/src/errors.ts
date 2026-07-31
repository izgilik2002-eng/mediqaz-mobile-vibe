import { z } from 'zod'

/**
 * Клиент переводит ошибку по коду, поэтому один код должен означать ровно одну
 * ситуацию. Общие коды ниже оставлены намеренно: старые сборки приложения будут
 * жить на телефонах врачей ещё долго после того, как бэкенд уедет вперёд, и
 * должны получать хотя бы осмысленный общий текст вместо пустоты.
 */
export const apiErrorCodeSchema = z.enum([
  // Общие. Возвращаются только там, где ситуация действительно общая:
  // неизвестный маршрут, отказ middleware, необработанное исключение.
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',

  // Вход и сессия.
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_EMAIL_ALREADY_EXISTS',
  'AUTH_PASSWORD_RESET_INVALID',
  'AUTH_INVALID_PROVIDER_TOKEN',
  'AUTH_PROVIDER_ACCOUNT_ALREADY_LINKED',
  'AUTH_PROVIDER_EMAIL_REQUIRED',
  'AUTH_PROVIDER_NOT_CONFIGURED',
  'AUTH_PROVIDER_UNAVAILABLE',

  // Доступ врача к записи приёмов.
  'DOCTOR_NOT_APPROVED',
  'DOCTOR_SPECIALTY_REQUIRED',

  // Приёмы и медкарта.
  'APPOINTMENT_NOT_FOUND',
  'APPOINTMENT_ALREADY_FINISHED',
  'APPOINTMENT_STATUS_NOT_ASSIGNABLE',
  'CONSULTATION_TRANSCRIPTION_UNAVAILABLE',
  'CONSULTATION_AUDIO_UNREADABLE',
  'CONSULTATION_MED_CARD_UNREADABLE',
  'CONSULTATION_PROVIDER_UNAVAILABLE',
  'CONSULTATION_MIS_DELIVERY_UNAVAILABLE',
  'CONSULTATION_MED_CARD_NOT_READY',

  // Администрирование пользователей.
  'USERS_ADMIN_REQUIRED',
  'USERS_NOT_FOUND',
  'USERS_SELF_DEMOTION',
  'USERS_LAST_ADMIN',

  // Push-уведомления.
  'PUSH_INSTALLATION_REJECTED',
  'PUSH_REGISTRATION_STALE',
  'PUSH_TOKEN_MISSING',
])

/**
 * Значения для подстановки в переведённую строку — например имя провайдера
 * входа, которое не переводится. Только строки: числа и даты форматируются
 * по локали, и сервер не знает язык клиента.
 */
export const apiErrorParamsSchema = z.record(z.string(), z.string())

export const apiErrorSchema = z.object({
  error: z.object({
    /**
     * A loose string, not apiErrorCodeSchema: a server deployed ahead of an
     * older client can send a code that client's bundled enum has never seen.
     * If this rejected the response, the whole payload — including `message`
     * — would fail to parse, and the client would fall back to a raw HTTP
     * status instead of the server's real (if untranslated) text. Backend
     * response construction still goes through AppError, which is typed to
     * apiErrorCodeSchema, so the server itself can never emit an invented code.
     */
    code: z.string(),
    /**
     * Резервный текст на случай, когда у клиента нет перевода для кода. Виден
     * пользователю, поэтому не должен содержать внутренних деталей.
     */
    message: z.string(),
    params: apiErrorParamsSchema.optional(),
    details: z.unknown().optional(),
  }),
})

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorParams = z.infer<typeof apiErrorParamsSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>
