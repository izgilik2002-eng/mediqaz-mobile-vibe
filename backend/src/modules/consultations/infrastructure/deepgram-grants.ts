import type {
  FetchLike,
  TranscriptionGrant,
  TranscriptionGrantIssuer,
} from '../application/ports'

const grantEndpoint = 'https://api.deepgram.com/v1/auth/grant'

type DeepgramGrantResponse = {
  access_token?: unknown
  expires_in?: unknown
}

export function createDeepgramGrantIssuer({
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 5_000,
}: {
  apiKey: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}): TranscriptionGrantIssuer {
  return {
    async issue({ ttlSeconds }): Promise<TranscriptionGrant> {
      const response = await fetchImpl(grantEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl_seconds: ttlSeconds }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        throw new Error(`Deepgram grant failed with status ${response.status}`)
      }

      const payload = (await response.json()) as DeepgramGrantResponse
      if (typeof payload.access_token !== 'string' || payload.access_token === '') {
        throw new Error('Deepgram grant response contained no access token')
      }

      const expiresIn =
        typeof payload.expires_in === 'number' && payload.expires_in > 0
          ? payload.expires_in
          : ttlSeconds

      return { accessToken: payload.access_token, expiresIn }
    },
  }
}
