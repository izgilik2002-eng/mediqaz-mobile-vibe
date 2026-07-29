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
  startAppointmentResponseSchema,
  transcriptionTokenResponseSchema,
  TRANSCRIPTION_PARAMS,
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
    502: upstreamResponse,
  },
})

const startAppointmentRoute = createRoute({
  method: 'post',
  path: '/appointments',
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
        params: { ...TRANSCRIPTION_PARAMS },
      },
      200,
    )
  })

  routes.openapi(startAppointmentRoute, async (c) => {
    const doctor = await doctorFrom(c)
    const appointment = await run(() => input.service.startAppointment(doctor))

    return c.json({ appointment }, 201)
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
    case 'med_card_unreadable':
      return new AppError(
        502,
        'CONSULTATION_MED_CARD_UNREADABLE',
        'Не удалось разобрать медкарту. Попробуйте сформировать её ещё раз.',
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
  }
}

function bearerToken(c: Context) {
  const authorization = c.req.header('authorization')
  if (!authorization?.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}
