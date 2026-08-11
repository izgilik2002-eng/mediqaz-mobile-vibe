import { expect, test } from 'bun:test'

import { KAZAKH_MEDICAL_GLOSSARY, buildMedCardSystemPrompt } from './prompts'

test('the Kazakh clinical glossary reaches the assembled system prompt', () => {
  const prompt = buildMedCardSystemPrompt({ specialty: 'therapist' })

  // "қызарған" -> "гиперемированный/покрасневший" is the exact pair this
  // glossary exists for: a doctor saying "зев өте қызарған" (the throat is
  // severely hyperemic) was previously translated as "зев ослаблен" (the
  // throat is weakened) — a different clinical finding, not a shorter
  // paraphrase of the same one.
  expect(prompt).toContain('қызарған → гиперемированный / покрасневший')
  expect(prompt).toContain('ГЛОССАРИЙ КАЗАХСКИХ МЕДИЦИНСКИХ ТЕРМИНОВ')
  expect(prompt).toContain('используй глоссарий')
})

test('every glossary entry is present in the prompt, not just the first one', () => {
  const prompt = buildMedCardSystemPrompt({ specialty: 'therapist' })

  for (const [kk, ru] of KAZAKH_MEDICAL_GLOSSARY) {
    expect(prompt, `missing glossary line for "${kk}"`).toContain(`${kk} → ${ru}`)
  }
})

test('the glossary has no duplicate Kazakh terms pointing at different translations', () => {
  const seen = new Map<string, string>()

  for (const [kk, ru] of KAZAKH_MEDICAL_GLOSSARY) {
    const existing = seen.get(kk)
    expect(existing, `"${kk}" is listed twice with different translations`).toBeUndefined()
    seen.set(kk, ru)
  }
})

test('the glossary appears once per prompt, not duplicated by a stray build step', () => {
  const prompt = buildMedCardSystemPrompt({ specialty: 'therapist' })

  expect(prompt.split('ГЛОССАРИЙ КАЗАХСКИХ МЕДИЦИНСКИХ ТЕРМИНОВ')).toHaveLength(2)
})
