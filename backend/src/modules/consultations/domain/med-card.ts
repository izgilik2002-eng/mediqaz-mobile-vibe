import {
  medCardSchema,
  MED_CARD_EMPTY_SECTION,
  MED_CARD_SECTIONS,
  visitTypeSchema,
  type MedCard,
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
    const section = source[key]
    const fields = typeof section === 'object' && section !== null
      ? (section as Record<string, unknown>)
      : {}

    card[key] = {
      текст: nonEmptyString(fields.текст) ?? MED_CARD_EMPTY_SECTION,
      цитата: nonEmptyString(fields.цитата) ?? '',
      ...(key === 'диагноз' ? { мкб10: nonEmptyString(fields.мкб10) ?? '' } : {}),
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
