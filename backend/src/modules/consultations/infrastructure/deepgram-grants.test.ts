import { expect, test } from 'bun:test'

import { createDeepgramGrantIssuer } from './deepgram-grants'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('requests a grant with the long-lived key and the requested lifetime', async () => {
  const calls: Array<{ authorization: string | null; body: unknown }> = []
  const issuer = createDeepgramGrantIssuer({
    apiKey: 'long-lived-key',
    fetchImpl: async (_input, init) => {
      calls.push({
        authorization: new Headers(init?.headers).get('Authorization'),
        body: JSON.parse(String(init?.body)),
      })
      return jsonResponse({ access_token: 'ephemeral', expires_in: 300 })
    },
  })

  await expect(issuer.issue({ ttlSeconds: 300 })).resolves.toEqual({
    accessToken: 'ephemeral',
    expiresIn: 300,
  })
  expect(calls[0]?.authorization).toBe('Token long-lived-key')
  expect(calls[0]?.body).toEqual({ ttl_seconds: 300 })
})

test('falls back to the requested lifetime when the provider omits one', async () => {
  const issuer = createDeepgramGrantIssuer({
    apiKey: 'k',
    fetchImpl: async () => jsonResponse({ access_token: 'ephemeral' }),
  })

  await expect(issuer.issue({ ttlSeconds: 120 })).resolves.toEqual({
    accessToken: 'ephemeral',
    expiresIn: 120,
  })
})

test('rejects a provider error instead of returning an unusable grant', async () => {
  const issuer = createDeepgramGrantIssuer({
    apiKey: 'k',
    fetchImpl: async () => jsonResponse({ error: 'forbidden' }, 403),
  })

  await expect(issuer.issue({ ttlSeconds: 300 })).rejects.toThrow('status 403')
})

test('rejects a success response that carries no token', async () => {
  const issuer = createDeepgramGrantIssuer({
    apiKey: 'k',
    fetchImpl: async () => jsonResponse({ expires_in: 300 }),
  })

  await expect(issuer.issue({ ttlSeconds: 300 })).rejects.toThrow('no access token')
})
