import {
  apiErrorSchema,
  appointmentParamsSchema,
  appointmentResponseSchema,
  appointmentsResponseSchema,
  askAboutConsultationRequestSchema,
  askAboutConsultationResponseSchema,
  appointmentStatusSchema,
  generateMedCardRequestSchema,
  generateMedCardResponseSchema,
  misDeliveryCodeResponseSchema,
  misDeliveryResponseSchema,
  startAppointmentRequestSchema,
  startAppointmentResponseSchema,
  transcriptionTokenResponseSchema,
} from '@mediqaz/contracts'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context } from 'hono'

import { AppError, errorResponse } from '../../../http/errors'
import type { AuthenticatedPrincipal } from '../../auth'
import type { ConsultationsService } from '../application/ports'
import { isClientReportableStatus } from '../domain/appointment'
import type { ConsultationDoctor } from '../domain/doctor'
import { ConsultationFailure } from '../domain/errors'

type AuthenticateAccessToken = (
  accessToken: string | undefined,
) => Promise<AuthenticatedPrincipal>

const errorResponseContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const forbiddenResponse = {
  content: errorResponseContent,
  description: 'The account is not approved for consultations',
}

const unauthorizedResponse = {
  content: errorResponseContent,
  description: 'Invalid access token',
}

const upstreamResponse = {
  content: errorResponseContent,
  description: 'A consultation provider is unavailable',
}

const transcriptionTokenRoute = createRoute({
  method: 'post',
  path: '/transcription-token',
  responses: {
    200: {
      content: { 'application/json': { schema: transcriptionTokenResponseSchema } },
      description: 'Short-lived credential and parameters for the transcription stream',
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    409: {
      content: errorResponseContent,
      description: 'No provider streams the doctor\'s transcription language',
    },
    502: upstreamResponse,
  },
})

const startAppointmentRoute = createRoute({
  method: 'post',
  path: '/appointments',
  request: {
    body: {
      content: { 'application/json': { schema: startAppointmentRequestSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: startAppointmentResponseSchema } },
      description: 'Consultation opened and recording',
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    409: { content: errorResponseContent, description: 'The doctor has no specialty set' },
  },
})

const audioRoute = createRoute({
  method: 'post',
  path: '/appointments/{appointmentId}/audio',
  request: { params: appointmentParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: generateMedCardResponseSchema } },
      description: 'Recording transcribed and med card generated',
    },
    400: { content: errorResponseContent, description: 'Empty recording or invalid content type' },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: { content: errorResponseContent, description: 'Consultation not found' },
    409: {
      content: errorResponseContent,
      description: 'No specialty set, or the consultation is already finished',
    },
    413: {
      content: errorResponseContent,
      description: 'The recording is longer than the provider accepts',
    },
    422: {
      content: errorResponseContent,
      description: 'The provider answered but recognized no speech in the recording',
    },
    502: upstreamResponse,
    504: {
      content: errorResponseContent,
      description: 'The transcription provider did not answer in time',
    },
  },
})

const reportProgressRoute = createRoute({
  method: 'patch',
  path: '/appointments/{appointmentId}/status',
  request: {
    params: appointmentParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: z.object({ status: appointmentStatusSchema }).strict(),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: startAppointmentResponseSchema } },
      description: 'Recorded device-side progress',
    },
    400: { content: errorResponseContent, description: 'Invalid payload or backend-owned status' },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: { content: errorResponseContent, description: 'Consultation not found' },
    409: { content: errorResponseContent, description: 'Consultation already finished' },
  },
})

const medCardRoute = createRoute({
  method: 'post',
  path: '/appointments/{appointmentId}/med-card',
  request: {
    params: appointmentParamsSchema,
    body: {
      content: { 'application/json': { schema: generateMedCardRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: generateMedCardResponseSchema } },
      description: 'Med card generated and stored for the consultation',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: { content: errorResponseContent, description: 'Consultation not found' },
    409: {
      content: errorResponseContent,
      description: 'No specialty set, or the consultation is already finished',
    },
    502: upstreamResponse,
  },
})

const questionRoute = createRoute({
  method: 'post',
  path: '/questions',
  request: {
    body: {
      content: { 'application/json': { schema: askAboutConsultationRequestSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: askAboutConsultationResponseSchema } },
      description: 'Answer grounded in the consultation transcript',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    409: {
      content: errorResponseContent,
      description: 'The doctor has no specialty set',
    },
    502: upstreamResponse,
  },
})

const appointmentsRoute = createRoute({
  method: 'get',
  path: '/appointments',
  responses: {
    200: {
      content: { 'application/json': { schema: appointmentsResponseSchema } },
      description: 'Consultations recorded by the current doctor',
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
  },
})

const appointmentRoute = createRoute({
  method: 'get',
  path: '/appointments/{appointmentId}',
  request: { params: appointmentParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: appointmentResponseSchema } },
      description: 'One consultation with its transcript and med card',
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: { content: errorResponseContent, description: 'Consultation not found' },
  },
})

const misDeliveryCodeRoute = createRoute({
  method: 'get',
  path: '/mis-delivery-code',
  responses: {
    200: {
      content: { 'application/json': { schema: misDeliveryCodeResponseSchema } },
      description: 'The delivery code for this doctor, issued on first request',
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    502: upstreamResponse,
  },
})

const regenerateMisDeliveryCodeRoute = createRoute({
  method: 'post',
  path: '/mis-delivery-code/regenerate',
  responses: {
    200: {
      content: { 'application/json': { schema: misDeliveryCodeResponseSchema } },
      description: 'A fresh delivery code; the previous one stops working',
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    502: upstreamResponse,
  },
})

const misDeliveryRoute = createRoute({
  method: 'post',
  path: '/appointments/{appointmentId}/mis-delivery',
  request: { params: appointmentParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: misDeliveryResponseSchema } },
      description: 'Med card handed to the delivery channel the extension watches',
    },
    401: unauthorizedResponse,
    403: forbiddenResponse,
    404: { content: errorResponseContent, description: 'Consultation not found' },
    409: { content: errorResponseContent, description: 'The consultation has no med card yet' },
    502: upstreamResponse,
  },
})

export function createConsultationRoutes(input: {
  authenticateAccessToken: AuthenticateAccessToken
  service: ConsultationsService
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

  const doctorFrom = (c: Context) => currentDoctor(c, input.authenticateAccessToken)

  routes.openapi(transcriptionTokenRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const grant = await run(() => input.service.issueTranscriptionGrant(doctor))

    return c.json(
      {
        accessToken: grant.accessToken,
        expiresIn: grant.expiresIn,
        // Whatever the provider for this doctor's language needs; the route
        // forwards it without reading it.
        params: grant.params,
      },
      200,
    )
  })

  routes.openapi(startAppointmentRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const appointment = await run(() =>
      input.service.startAppointment(doctor, c.req.valid('json')),
    )

    return c.json({ appointment }, 201)
  })

  routes.openapi(audioRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const { appointmentId } = c.req.valid('param')

    const contentType = c.req.header('content-type')?.trim().toLowerCase()
    if (!contentType?.startsWith('audio/')) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Recording content type is invalid')
    }

    const buffer = await c.req.arrayBuffer()
    if (buffer.byteLength === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Recording is empty')
    }

    const result = await run(() =>
      input.service.transcribeAndGenerateMedCard({
        doctor,
        appointmentId,
        audio: new Uint8Array(buffer),
        contentType,
      }),
    )

    return c.json(result, 200)
  })

  routes.openapi(reportProgressRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const { status } = c.req.valid('json')

    // Generation and completion are decided by the backend; a device claiming
    // them would be asserting a medical record it did not produce.
    if (!isClientReportableStatus(status)) {
      throw new AppError(400, 'APPOINTMENT_STATUS_NOT_ASSIGNABLE', 'Этот статус проставляет только сервер.')
    }

    const appointment = await run(() =>
      input.service.reportProgress({
        doctor,
        appointmentId: c.req.valid('param').appointmentId,
        status,
      }),
    )

    return c.json({ appointment }, 200)
  })

  routes.openapi(medCardRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const result = await run(() =>
      input.service.generateMedCard({
        doctor,
        appointmentId: c.req.valid('param').appointmentId,
        ...c.req.valid('json'),
      }),
    )

    return c.json(result, 200)
  })

  routes.openapi(questionRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const answer = await run(() =>
      input.service.askQuestion({ doctor, ...c.req.valid('json') }),
    )

    return c.json({ answer }, 200)
  })

  routes.openapi(appointmentsRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const appointments = await run(() => input.service.listAppointments(doctor))

    return c.json(appointments, 200)
  })

  routes.openapi(appointmentRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const { appointmentId } = c.req.valid('param')
    const appointment = await run(() =>
      input.service.getAppointment({ doctor, appointmentId }),
    )

    return c.json({ appointment }, 200)
  })

  routes.openapi(misDeliveryCodeRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const code = await run(() => input.service.misDeliveryCode(doctor))

    return c.json({ code }, 200)
  })

  routes.openapi(regenerateMisDeliveryCodeRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const code = await run(() => input.service.regenerateMisDeliveryCode(doctor))

    return c.json({ code }, 200)
  })

  routes.openapi(misDeliveryRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const { appointmentId } = c.req.valid('param')
    const delivery = await run(() =>
      input.service.sendMedCardToMis({ doctor, appointmentId }),
    )

    return c.json(
      {
        deliveredAt: delivery.deliveredAt.toISOString(),
        expiresAt: delivery.expiresAt.toISOString(),
      },
      200,
    )
  })

  return routes
}

/**
 * Domain failures become HTTP status codes here. Provider status codes, keys,
 * and transcript content never reach the response.
 */
async function run<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ConsultationFailure) throw toAppError(error)
    throw error
  }
}

function toAppError(failure: ConsultationFailure) {
  switch (failure.code) {
    case 'not_approved':
      return new AppError(
        403,
        'DOCTOR_NOT_APPROVED',
        'Ваш аккаунт ещё не одобрен администратором.',
      )
    case 'specialty_required':
      return new AppError(
        409,
        'DOCTOR_SPECIALTY_REQUIRED',
        'Укажите специальность в профиле, чтобы формировать медкарты.',
      )
    case 'appointment_not_found':
      return new AppError(404, 'APPOINTMENT_NOT_FOUND', 'Приём не найден.')
    case 'appointment_already_finished':
      return new AppError(409, 'APPOINTMENT_ALREADY_FINISHED', 'Этот приём уже завершён.')
    case 'transcription_unavailable':
      return new AppError(
        502,
        'CONSULTATION_TRANSCRIPTION_UNAVAILABLE',
        'Не удалось начать запись приёма. Попробуйте ещё раз.',
      )
    case 'audio_transcription_failed':
      return new AppError(
        502,
        'CONSULTATION_AUDIO_UNREADABLE',
        'Не удалось распознать запись. Попробуйте отправить приём ещё раз.',
      )
    case 'med_card_unreadable':
      return new AppError(
        502,
        'CONSULTATION_MED_CARD_UNREADABLE',
        'Не удалось разобрать медкарту. Попробуйте сформировать её ещё раз.',
      )
    case 'med_card_not_ready':
      return new AppError(
        409,
        'CONSULTATION_MED_CARD_NOT_READY',
        'Медкарта по этому приёму ещё не готова.',
      )
    case 'mis_delivery_unavailable':
      return new AppError(
        502,
        'CONSULTATION_MIS_DELIVERY_UNAVAILABLE',
        'Не удалось отправить медкарту в расширение. Попробуйте ещё раз.',
      )
    case 'recording_too_long':
      // 413, not 502: nothing is wrong upstream and retrying the same file
      // fails the same way. The recording itself is the problem.
      return new AppError(
        413,
        'CONSULTATION_RECORDING_TOO_LONG',
        'Запись слишком длинная для распознавания. Запишите приём короче.',
      )
    case 'transcription_timed_out':
      // 504, not 413: nothing is wrong with the recording, and unlike a
      // too-long file this one is worth sending again as is.
      return new AppError(
        504,
        'CONSULTATION_TRANSCRIPTION_TIMED_OUT',
        'Сервис распознавания не ответил вовремя. Отправьте запись ещё раз.',
      )
    case 'speech_not_recognized':
      // 422: the request was fine and the provider answered successfully —
      // this is neither an outage (502/504) nor a length problem (413), so it
      // gets its own status instead of implying something is broken upstream.
      return new AppError(
        422,
        'CONSULTATION_SPEECH_NOT_RECOGNIZED',
        'Не удалось распознать речь в записи. Убедитесь, что запись не пустая и звук слышен, затем попробуйте ещё раз.',
      )
    case 'live_unavailable_for_language':
      return new AppError(
        409,
        'CONSULTATION_LIVE_UNAVAILABLE_FOR_LANGUAGE',
        'Живая расшифровка недоступна для выбранного языка.',
      )
    default:
      return new AppError(
        502,
        'CONSULTATION_PROVIDER_UNAVAILABLE',
        'Сервис временно недоступен. Попробуйте ещё раз.',
      )
  }
}

async function currentDoctor(
  c: Context,
  authenticateAccessToken: AuthenticateAccessToken,
): Promise<ConsultationDoctor> {
  const principal = await authenticateAccessToken(bearerToken(c))
  return {
    id: principal.id,
    isApproved: principal.isApproved,
    specialty: principal.specialty,
    transcriptionLanguage: principal.transcriptionLanguage,
  }
}

function bearerToken(c: Context) {
  const authorization = c.req.header('authorization')
  if (!authorization?.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}
