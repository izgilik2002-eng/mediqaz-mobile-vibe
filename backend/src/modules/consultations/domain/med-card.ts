import {
  medCardSchema,
  MED_CARD_EMPTY_SECTION,
  MED_CARD_SECTIONS,
  visitTypeSchema,
  type MedCard,
  type PrescriptionItem,
} from '@mediqaz/contracts'

export class MedCardParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MedCardParseError'
  }
}

/**
 * Turns a model completion into a med card.
 *
 * The model is instructed to answer with bare JSON but in practice sometimes
 * wraps it in markdown or adds a preamble, so we try a direct parse first and
 * then fall back to the first balanced object in the text.
 */
export function parseMedCard(raw: string): MedCard {
  const cleaned = raw.replaceAll(/```json|```/g, '').trim()

  try {
    return backfillSections(JSON.parse(cleaned))
  } catch (error) {
    if (error instanceof MedCardParseError) throw error
  }

  const objectText = firstBalancedObject(cleaned)
  if (!objectText) {
    throw new MedCardParseError('Model response contained no complete JSON object')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(objectText)
  } catch {
    throw new MedCardParseError('Model response contained malformed JSON')
  }

  return backfillSections(parsed)
}

/**
 * A section the model omitted means "not discussed", not a broken card, so the
 * missing sections are filled with the agreed empty-section wording instead of
 * failing the whole consultation.
 */
function backfillSections(parsed: unknown): MedCard {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new MedCardParseError('Model response was not a JSON object')
  }

  const source = parsed as Record<string, unknown>
  const visitType = visitTypeSchema.safeParse(source.тип_приема)
  const card: Record<string, unknown> = {
    тип_приема: visitType.success ? visitType.data : null,
  }

  for (const { key } of MED_CARD_SECTIONS) {
    if (key === 'назначения') {
      const section = source.назначения
      const rawItems = typeof section === 'object' && section !== null
        ? (section as Record<string, unknown>).items
        : undefined
      card[key] = { items: backfillPrescriptions(rawItems) }
      continue
    }

    if (key === 'красные_флаги') {
      card[key] = backfillRedFlags(source.красные_флаги)
      continue
    }

    if (key === 'диагноз_врача') {
      card[key] = backfillDoctorDiagnosis(source.диагноз_врача)
      continue
    }

    const section = source[key]
    const fields = typeof section === 'object' && section !== null
      ? (section as Record<string, unknown>)
      : {}

    card[key] = {
      текст: nonEmptyString(fields.текст) ?? MED_CARD_EMPTY_SECTION,
      цитата: nonEmptyString(fields.цитата) ?? '',
    }
  }

  const result = medCardSchema.safeParse(card)
  if (!result.success) {
    throw new MedCardParseError('Model response did not match the med-card shape')
  }
  return result.data
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Only an entry that actually names a drug counts as a prescription — one
 * without "препарат" is the model inventing structure, not a real omission to
 * backfill. Every other field stays `null` rather than an empty string when
 * the model left it out, so "not specified" cannot be confused with "specified
 * as nothing": a dosing condition silently becoming "" would read as
 * unconditional, which is a different prescription.
 */
function backfillPrescriptions(value: unknown): PrescriptionItem[] {
  if (!Array.isArray(value)) return []

  const items: PrescriptionItem[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const fields = entry as Record<string, unknown>
    const препарат = nonEmptyString(fields.препарат)
    if (!препарат) continue

    items.push({
      препарат,
      доза: nonEmptyString(fields.доза) ?? null,
      кратность: nonEmptyString(fields.кратность) ?? null,
      длительность: nonEmptyString(fields.длительность) ?? null,
      условие_приема: nonEmptyString(fields.условие_приема) ?? null,
      цитата: nonEmptyString(fields.цитата) ?? '',
    })
  }
  return items
}

/**
 * Backfills to `null`, never to `MED_CARD_EMPTY_SECTION`. A diagnosis the
 * doctor did not state must stay empty rather than pick up wording that reads
 * like a finding — this is the section the extension writes into the official
 * Damumed/e-MIS entry.
 *
 * The two fields are filled independently: a doctor may state a diagnosis in
 * words, name only a code, or neither, and dropping one because the other is
 * missing would discard something that was actually said.
 *
 * Only `текст`, `мкб10`, and `цитата` are ever read off the model's object —
 * any other property the model attaches here (an inferred code under a
 * different name, a stray "предположение" field despite the prompt
 * forbidding it) is silently not looked at. The model is never asked for a
 * diagnostic guess in any field, in any shape; this function does not go
 * looking for one either.
 */
function backfillDoctorDiagnosis(value: unknown) {
  const fields = typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}

  return {
    текст: nonEmptyString(fields.текст) ?? null,
    мкб10: nonEmptyString(fields.мкб10) ?? null,
    цитата: nonEmptyString(fields.цитата) ?? '',
  }
}

/**
 * `текст` backfills to `null`, not `MED_CARD_EMPTY_SECTION` like every other
 * section: "the doctor said nothing about red flags" has to stay visibly
 * distinct from every other section's "not discussed" placeholder, so it
 * cannot be mistaken for a checked-and-clear answer.
 */
function backfillRedFlags(value: unknown): { текст: string | null; цитата: string } {
  const fields = typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}

  return {
    текст: nonEmptyString(fields.текст) ?? null,
    цитата: nonEmptyString(fields.цитата) ?? '',
  }
}

function firstBalancedObject(text: string) {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const character = text[index]

    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }

  return null
}
