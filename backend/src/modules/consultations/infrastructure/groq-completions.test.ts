import { expect, test } from 'bun:test'

import { createGroqCompletionClient } from './groq-completions'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const completion = { choices: [{ message: { content: 'ответ' } }] }
const messages = [{ role: 'user' as const, content: 'вопрос' }]

test('sends the API key as a bearer token and returns the message content', async () => {
  const calls: Array<{ authorization: string | null; body: unknown }> = []
  const client = createGroqCompletionClient({
    apiKey: 'secret-key',
    fetchImpl: async (_input, init) => {
      calls.push({
        authorization: new Headers(init?.headers).get('Authorization'),
        body: JSON.parse(String(init?.body)),
      })
      return jsonResponse(completion)
    },
  })

  await expect(client.complete({ messages })).resolves.toBe('ответ')
  expect(calls[0]?.authorization).toBe('Bearer secret-key')
  expect(calls[0]?.body).toMatchObject({ model: 'llama-3.3-70b-versatile', temperature: 0.3 })
})

test('asks for a JSON object only when the use case needs one', async () => {
  const bodies: Array<Record<string, unknown>> = []
  const client = createGroqCompletionClient({
    apiKey: 'k',
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return jsonResponse(completion)
    },
  })

  await client.complete({ messages, jsonObject: true })
  await client.complete({ messages })

  expect(bodies[0]?.response_format).toEqual({ type: 'json_object' })
  expect(bodies[1]?.response_format).toBeUndefined()
})

test('retries transient provider failures with backoff', async () => {
  const statuses = [503, 429, 200]
  const delays: number[] = []
  let attempt = 0

  const client = createGroqCompletionClient({
    apiKey: 'k',
    sleep: async (ms) => {
      delays.push(ms)
    },
    fetchImpl: async () => {
      const status = statuses[attempt] ?? 200
      attempt += 1
      return status === 200 ? jsonResponse(completion) : jsonResponse({}, status)
    },
  })

  await expect(client.complete({ messages })).resolves.toBe('ответ')
  expect(attempt).toBe(3)
  expect(delays).toEqual([1_000, 2_000])
})

test('does not retry a rejected request', async () => {
  let attempt = 0
  const client = createGroqCompletionClient({
    apiKey: 'k',
    sleep: async () => undefined,
    fetchImpl: async () => {
      attempt += 1
      return jsonResponse({ error: 'bad request' }, 400)
    },
  })

  await expect(client.complete({ messages })).rejects.toThrow('status 400')
  expect(attempt).toBe(1)
})

test('gives up after the attempt budget instead of retrying forever', async () => {
  let attempt = 0
  const client = createGroqCompletionClient({
    apiKey: 'k',
    sleep: async () => undefined,
    fetchImpl: async () => {
      attempt += 1
      return jsonResponse({}, 503)
    },
  })

  await expect(client.complete({ messages })).rejects.toThrow('status 503')
  expect(attempt).toBe(3)
})

test('keeps provider calls within the concurrency budget', async () => {
  let inFlight = 0
  let peak = 0
  const client = createGroqCompletionClient({
    apiKey: 'k',
    maxConcurrent: 1,
    fetchImpl: async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return jsonResponse(completion)
    },
  })

  await Promise.all([
    client.complete({ messages }),
    client.complete({ messages }),
    client.complete({ messages }),
  ])

  expect(peak).toBe(1)
})

test('fails fast instead of queueing without bound', async () => {
  const client = createGroqCompletionClient({
    apiKey: 'k',
    maxConcurrent: 1,
    maxQueued: 1,
    fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return jsonResponse(completion)
    },
  })

  const results = await Promise.allSettled([
    client.complete({ messages }),
    client.complete({ messages }),
    client.complete({ messages }),
  ])

  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
})

test('treats a response without content as an empty completion', async () => {
  const client = createGroqCompletionClient({
    apiKey: 'k',
    fetchImpl: async () => jsonResponse({ choices: [] }),
  })

  await expect(client.complete({ messages })).resolves.toBe('')
})
