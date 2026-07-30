import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { AuthenticatedPrincipal } from '../auth'
import { createConsultationsService } from './application/consultations-service'
import type {
  AppointmentStore,
  AudioTranscriber,
  CompletionClient,
  TranscriptionGrantIssuer,
} from './application/ports'
import { createPrismaAppointmentStore } from './infrastructure/appointments-repository'
import { createDeepgramAudioTranscriber } from './infrastructure/deepgram-transcription'
import { createDeepgramGrantIssuer } from './infrastructure/deepgram-grants'
import { createGroqCompletionClient } from './infrastructure/groq-completions'
import { createConsultationRoutes } from './transport/routes'

type CreateConsultationsModuleOptions = {
  db: DbClient
  env: AppEnv
  /** Overridable so tests do not reach the real providers. */
  appointments?: AppointmentStore
  audioTranscriber?: AudioTranscriber
  completions?: CompletionClient
  transcriptionGrants?: TranscriptionGrantIssuer
}

export function createConsultationsModule({
  appointments,
  audioTranscriber,
  db,
  env,
  completions,
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
    audioTranscriber:
      audioTranscriber ??
      createDeepgramAudioTranscriber({ apiKey: requireProviderKey(env, 'DEEPGRAM_API_KEY') }),
    transcriptionGrantTtlSeconds: env.TRANSCRIPTION_GRANT_TTL_SECONDS,
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
  TranscriptionGrantIssuer,
} from './application/ports'
