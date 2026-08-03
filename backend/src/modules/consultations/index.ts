import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { AuthenticatedPrincipal } from '../auth'
import { createConsultationsService } from './application/consultations-service'
import type {
  AppointmentStore,
  CompletionClient,
  MedCardDeliveryPublisher,
  MisDeliveryCodeStore,
  TranscriptionGrantIssuer,
  TranscriptionRouter,
} from './application/ports'
import { createPrismaAppointmentStore } from './infrastructure/appointments-repository'
import { createDeepgramTranscriptionRouter } from './infrastructure/transcription-router'
import { createDeepgramGrantIssuer } from './infrastructure/deepgram-grants'
import { createGroqCompletionClient } from './infrastructure/groq-completions'
import { createPrismaMisDeliveryCodeStore } from './infrastructure/mis-delivery-code-repository'
import { createSupabaseMedCardDeliveryPublisher } from './infrastructure/supabase-delivery'
import { createConsultationRoutes } from './transport/routes'

type CreateConsultationsModuleOptions = {
  db: DbClient
  env: AppEnv
  /** Overridable so tests do not reach the real providers. */
  appointments?: AppointmentStore
  completions?: CompletionClient
  medCardDelivery?: MedCardDeliveryPublisher
  misDeliveryCodes?: MisDeliveryCodeStore
  transcription?: TranscriptionRouter
  transcriptionGrants?: TranscriptionGrantIssuer
}

export function createConsultationsModule({
  appointments,
  db,
  env,
  completions,
  medCardDelivery,
  misDeliveryCodes,
  transcription,
  transcriptionGrants,
}: CreateConsultationsModuleOptions) {
  const service = createConsultationsService({
    appointments: appointments ?? createPrismaAppointmentStore(db),
    completions:
      completions ??
      createGroqCompletionClient({
        apiKey: requireProviderKey(env, 'GROQ_API_KEY'),
        maxConcurrent: env.GROQ_MAX_CONCURRENT,
      }),
    transcriptionGrants:
      transcriptionGrants ??
      createDeepgramGrantIssuer({ apiKey: requireProviderKey(env, 'DEEPGRAM_API_KEY') }),
    transcription:
      transcription ??
      createDeepgramTranscriptionRouter({
        apiKey: requireProviderKey(env, 'DEEPGRAM_API_KEY'),
        whisperModel: env.DEEPGRAM_WHISPER_MODEL || undefined,
        maxAudioSeconds: env.TRANSCRIPTION_MAX_AUDIO_SECONDS,
      }),
    // Unlike the transcription and completion providers, delivery is optional:
    // a deployment without Supabase still records consultations and generates
    // med cards, it just cannot hand them to the extension. The service turns a
    // missing publisher into a clean 502 on that one endpoint.
    medCardDelivery: medCardDelivery ?? createDeliveryPublisher(env),
    misDeliveryCodes: misDeliveryCodes ?? createPrismaMisDeliveryCodeStore(db),
    transcriptionGrantTtlSeconds: env.TRANSCRIPTION_GRANT_TTL_SECONDS,
    misDeliveryTtlHours: env.MIS_DELIVERY_TTL_HOURS,
  })

  return {
    createRoutes: (
      authenticateAccessToken: (
        accessToken: string | undefined,
      ) => Promise<AuthenticatedPrincipal>,
    ) => createConsultationRoutes({ authenticateAccessToken, service }),
    service,
  }
}

/**
 * Recording a consultation is the product, so a production API without these
 * keys is broken. Failing when the API is composed surfaces that at deploy time
 * instead of when a doctor first presses record. Background entrypoints never
 * build this module, so the worker and cron stay deployable without the keys.
 */
/**
 * Both halves are required together: a URL without a key cannot authenticate,
 * and a key without a URL has nowhere to go. Either one missing leaves delivery
 * unconfigured rather than half-wired.
 */
function createDeliveryPublisher(env: AppEnv): MedCardDeliveryPublisher | undefined {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return undefined

  return createSupabaseMedCardDeliveryPublisher({
    url: env.SUPABASE_URL,
    secretKey: env.SUPABASE_SECRET_KEY,
  })
}

function requireProviderKey(env: AppEnv, key: 'DEEPGRAM_API_KEY' | 'GROQ_API_KEY') {
  const value = env[key]
  if (value) return value

  if (env.NODE_ENV === 'production') {
    throw new Error(`${key} is required to serve consultations in production`)
  }
  return ''
}

export type {
  AppointmentStore,
  AudioTranscriber,
  CompletionClient,
  ConsultationsService,
  MedCardDeliveryPublisher,
  MisDeliveryCodeStore,
  TranscriptionGrantIssuer,
  TranscriptionRouter,
} from './application/ports'
