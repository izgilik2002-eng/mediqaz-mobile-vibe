import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { buildMedCardSystemPrompt, buildMedCardUserPrompt } from './domain/prompts'
import { parseMedCard } from './domain/med-card'
import { createGroqCompletionClient } from './infrastructure/groq-completions'

const fixturePath = join(import.meta.dir, '../../../tests/fixtures/reception-kk-tonsillitis.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { transcript: string; notes: string }

/**
 * Regression test against a real Kazakh/Russian-mixed consultation transcript
 * that previously exposed real bugs in production (a diagnosis the doctor
 * never stated, a hallucinated "через неделю" next visit, a mistranslated
 * "ослаблен" for "гиперемирован", a dropped dosing condition, both drugs from
 * a doctor's self-correction landing in the card, and the red-flags/anamnesis
 * sections going missing entirely).
 *
 * This calls the real Groq API — no mock, because the point is to catch
 * regressions the model itself introduces, not regressions in a stub. It is
 * therefore excluded from `test:unit` and only registered here; run it by
 * hand with GROQ_API_KEY set:
 *
 *   GROQ_API_KEY=... bun test src/modules/consultations/med-card-golden.integration.test.ts
 *
 * Wording varies between runs, so the assertions target only the specific
 * facts above rather than exact text — a golden case that demanded byte-exact
 * output would fail on harmless rephrasing and stop catching real regressions.
 */
const apiKey = process.env.GROQ_API_KEY
const maybeDescribe = apiKey ? describe : describe.skip

maybeDescribe('med card golden case: real Kazakh/Russian consultation transcript', () => {
  test('the model output survives every fact this transcript previously broke', async () => {
    const completions = createGroqCompletionClient({ apiKey: apiKey! })

    const completion = await completions.complete({
      messages: [
        { role: 'system', content: buildMedCardSystemPrompt({ specialty: 'therapist' }) },
        { role: 'user', content: buildMedCardUserPrompt(fixture.transcript) },
      ],
      jsonObject: true,
    })

    const medCard = parseMedCard(completion)

    // 1. The doctor never states a diagnosis or an ICD-10 code — "бұл
    // бактериальды инфекция белгісі" about the tonsils is a description of a
    // finding, not a diagnosis. A regression here means the model is
    // inferring a diagnosis again, which the extension writes into the
    // official Damumed/e-MIS record under the doctor's name.
    expect(medCard.диагноз_врача.текст).toBeNull()
    expect(medCard.диагноз_врача.мкб10).toBeNull()

    // 2. The doctor says "бес күннен кейін" (in 5 days), not "через неделю" —
    // a real hallucination seen in production.
    expect(medCard.следующий_прием.текст.toLowerCase()).not.toContain('недел')
    expect(medCard.следующий_прием.текст.toLowerCase()).not.toContain('week')

    // 3. "зев өте қызарған" is hyperemic/reddened, not "weakened" — a real
    // mistranslation seen in production.
    expect(medCard.объективно.текст.toLowerCase()).not.toContain('ослаблен')

    // 4. The paracetamol/ibuprofen dosing condition ("only above 38.5") must
    // survive — it was silently dropped before task 1 structured назначения.
    const feverConditionedDrug = medCard.назначения.items.find(
      (item) => item.условие_приема?.includes('38.5') || item.условие_приема?.includes('38,5'),
    )
    expect(feverConditionedDrug).toBeDefined()

    // 5. The doctor names amoxicillin, then corrects himself out loud because
    // of the penicillin allergy and prescribes azithromycin instead — only
    // the final decision belongs in the card, not both.
    const drugNames = medCard.назначения.items.map((item) => item.препарат.toLowerCase())
    expect(drugNames.some((name) => name.includes('азитромицин'))).toBe(true)
    expect(drugNames.some((name) => name.includes('амоксициллин'))).toBe(false)

    // 6. Both halves of the red flag the doctor actually said — fever above
    // 39 and chest pain — must survive. Red flags were dropped entirely
    // before task 1 added a mandatory красные_флаги section.
    expect(medCard.красные_флаги.текст).not.toBeNull()
    expect(medCard.красные_флаги.текст).toContain('39')
    expect(medCard.красные_флаги.текст!.toLowerCase()).toMatch(/груд|кеуде/)

    // 7. The patient is a teacher with sick children in her class — an
    // epidemiological fact that was previously lost entirely.
    expect(medCard.анамнез.текст.toLowerCase()).toMatch(/учител|класс|контакт/)
  }, 60_000)
})
