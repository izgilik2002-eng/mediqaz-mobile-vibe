import type { CompletionClient, CompletionMessage, FetchLike } from '../application/ports'

const completionsEndpoint = 'https://api.groq.com/openai/v1/chat/completions'
const retryableStatuses = new Set([429, 500, 502, 503])

type CompletionResponse = {
  choices?: Array<{ message?: { content?: unknown } }>
}

export function createGroqCompletionClient({
  apiKey,
  model = 'llama-3.3-70b-versatile',
  temperature = 0.3,
  maxAttempts = 3,
  maxConcurrent = 1,
  maxQueued = 32,
  timeoutMs = 60_000,
  fetchImpl = fetch,
  sleep = defaultSleep,
}: {
  apiKey: string
  model?: string
  temperature?: number
  maxAttempts?: number
  maxConcurrent?: number
  maxQueued?: number
  timeoutMs?: number
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
}): CompletionClient {
  const gate = createConcurrencyGate({ maxConcurrent, maxQueued })

  async function request(messages: CompletionMessage[], jsonObject: boolean, attempt: number): Promise<string> {
    const response = await fetchImpl(completionsEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        messages,
        ...(jsonObject ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      if (retryableStatuses.has(response.status) && attempt + 1 < maxAttempts) {
        await sleep(1_000 * (attempt + 1))
        return request(messages, jsonObject, attempt + 1)
      }
      throw new Error(`Groq completion failed with status ${response.status}`)
    }

    const payload = (await response.json()) as CompletionResponse
    const content = payload.choices?.[0]?.message?.content
    return typeof content === 'string' ? content : ''
  }

  return {
    complete: ({ messages, jsonObject = false }) =>
      gate(() => request(messages, jsonObject, 0)),
  }
}

/**
 * Keeps provider calls within the account's concurrency budget and rejects
 * rather than queueing without bound, so a burst fails fast instead of holding
 * requests until they time out.
 */
function createConcurrencyGate({
  maxConcurrent,
  maxQueued,
}: {
  maxConcurrent: number
  maxQueued: number
}) {
  let running = 0
  const waiting: Array<() => void> = []

  function release() {
    running -= 1
    const next = waiting.shift()
    if (next) next()
  }

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= maxConcurrent) {
      if (waiting.length >= maxQueued) {
        throw new Error('Groq completion queue is full')
      }
      await new Promise<void>((resolve) => waiting.push(resolve))
    }

    running += 1
    try {
      return await task()
    } finally {
      release()
    }
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
