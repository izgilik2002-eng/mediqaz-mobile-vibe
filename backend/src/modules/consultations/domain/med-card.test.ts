import { expect, test } from 'bun:test'

import { MED_CARD_EMPTY_SECTION } from '@mediqaz/contracts'

import { MedCardParseError, parseMedCard } from './med-card'

const completeCard = {
  тип_приема: 'Первичный',
  жалобы: { текст: 'Боль в горле', цитата: 'горло болит' },
  анамнез: { текст: 'Болеет три дня', цитата: 'три дня' },
  объективно: { текст: 'Зев гиперемирован', цитата: 'зев красный' },
  диагноз_врача: { текст: 'Острый фарингит', мкб10: 'J02.9', цитата: 'фарингит' },
  назначения: {
    items: [
      {
        препарат: 'Парацетамол',
        доза: '500 мг',
        кратность: 'при необходимости',
        длительность: null,
        условие_приема: 'только при температуре выше 38.5',
        цитата: 'парацетамол если температура выше 38.5',
      },
    ],
  },
  красные_флаги: { текст: 'Затруднённое дыхание, температура выше 39.5', цитата: 'если тяжело дышать — сразу скорую' },
  рекомендации: { текст: 'Обильное питьё', цитата: 'пить больше' },
  следующий_прием: { текст: 'Через 5 дней', цитата: 'через пять дней' },
}

test('parses a bare JSON completion', () => {
  const card = parseMedCard(JSON.stringify(completeCard))

  expect(card.диагноз_врача.мкб10).toBe('J02.9')
  expect(card.тип_приема).toBe('Первичный')
})

test('parses JSON the model wrapped in markdown or a preamble', () => {
  const wrapped = `Конечно, вот медкарта:\n\`\`\`json\n${JSON.stringify(completeCard)}\n\`\`\`\nГотово.`

  expect(parseMedCard(wrapped).жалобы.текст).toBe('Боль в горле')
})

test('ignores a trailing brace inside a quote when finding the JSON object', () => {
  const card = {
    ...completeCard,
    жалобы: { текст: 'Пациент сказал "} конец"', цитата: 'горло' },
  }

  expect(parseMedCard(`Ответ: ${JSON.stringify(card)} — всё`).жалобы.текст).toBe(
    'Пациент сказал "} конец"',
  )
})

test('backfills sections the model omitted so one gap does not lose the card', () => {
  const { анамнез: _omitted, ...partial } = completeCard
  const card = parseMedCard(JSON.stringify(partial))

  expect(card.анамнез.текст).toBe(MED_CARD_EMPTY_SECTION)
  expect(card.анамнез.цитата).toBe('')
  expect(card.жалобы.текст).toBe('Боль в горле')
})

test('a diagnosis the doctor never stated backfills to null, not to a placeholder', () => {
  const { диагноз_врача: _omitted, ...partial } = completeCard
  const card = parseMedCard(JSON.stringify(partial))

  // Never MED_CARD_EMPTY_SECTION here. This section becomes the official
  // Damumed/e-MIS entry, so wording that reads like a finding is worse than
  // an empty field — and an ICD code with no stated diagnosis behind it is
  // exactly the inference this split exists to keep out.
  expect(card.диагноз_врача.текст).toBeNull()
  expect(card.диагноз_врача.мкб10).toBeNull()
  expect(card.диагноз_врача.цитата).toBe('')
})

test("the doctor's text and code are backfilled independently, not as a pair", () => {
  // A doctor may name a diagnosis in words without a code, or say only the
  // code. Dropping one because the other is missing would discard something
  // that was actually said.
  const wordsOnly = parseMedCard(
    JSON.stringify({
      ...completeCard,
      диагноз_врача: { текст: 'Фарингит', цитата: 'фарингит' },
    }),
  )
  expect(wordsOnly.диагноз_врача.текст).toBe('Фарингит')
  expect(wordsOnly.диагноз_врача.мкб10).toBeNull()

  const codeOnly = parseMedCard(
    JSON.stringify({ ...completeCard, диагноз_врача: { мкб10: 'J02.9', цитата: 'жэ ноль два' } }),
  )
  expect(codeOnly.диагноз_врача.текст).toBeNull()
  expect(codeOnly.диагноз_врача.мкб10).toBe('J02.9')
})

test('a diagnostic guess the model attaches anyway is ignored, not merged in', () => {
  // The prompt forbids the model from proposing a diagnosis, but nothing stops
  // a disobedient completion from attaching one anyway — as a stray top-level
  // key, or as an extra property tucked inside диагноз_врача itself. Either
  // way it must not leak into the parsed card, because that card becomes the
  // official Damumed/e-MIS entry.
  const raw = {
    ...completeCard,
    диагноз_врача: {
      текст: null,
      мкб10: null,
      цитата: '',
      предположение_ai: 'Вирусный фарингит',
    },
    предположение_ai: { текст: 'Вирусный фарингит', мкб10: 'J02.9' },
  }

  const card = parseMedCard(JSON.stringify(raw))

  expect(card.диагноз_врача).toEqual({ текст: null, мкб10: null, цитата: '' })
  expect(card).not.toHaveProperty('предположение_ai')
})

test('preserves a dosing condition exactly, without simplifying it away', () => {
  const card = parseMedCard(JSON.stringify(completeCard))

  // The whole point of structuring назначения: "Парацетамол при температуре
  // выше 38.5" and "Парацетамол" are different prescriptions. Losing this
  // field silently would change what the doctor ordered.
  expect(card.назначения.items).toEqual([
    {
      препарат: 'Парацетамол',
      доза: '500 мг',
      кратность: 'при необходимости',
      длительность: null,
      условие_приема: 'только при температуре выше 38.5',
      цитата: 'парацетамол если температура выше 38.5',
    },
  ])
})

test('an unspecified prescription field becomes null, never an empty string or a guess', () => {
  const card = parseMedCard(
    JSON.stringify({
      ...completeCard,
      назначения: {
        items: [
          { препарат: 'Ибупрофен', доза: '', кратность: null, длительность: undefined },
        ],
      },
    }),
  )

  // Missing is missing. An empty string here would be indistinguishable from
  // "the doctor said to take it with nothing" — a different, wrong claim.
  expect(card.назначения.items).toEqual([
    {
      препарат: 'Ибупрофен',
      доза: null,
      кратность: null,
      длительность: null,
      условие_приема: null,
      цитата: '',
    },
  ])
})

test('a prescription entry with no drug name is dropped rather than kept as a blank row', () => {
  const card = parseMedCard(
    JSON.stringify({
      ...completeCard,
      назначения: {
        items: [
          { препарат: '', доза: '500 мг' },
          { доза: '10 мг' },
          completeCard.назначения.items[0],
        ],
      },
    }),
  )

  expect(card.назначения.items).toHaveLength(1)
  expect(card.назначения.items[0]?.препарат).toBe('Парацетамол')
})

test('назначения omitted by the model backfills to an empty list, not a missing field', () => {
  const { назначения: _omitted, ...partial } = completeCard
  const card = parseMedCard(JSON.stringify(partial))

  expect(card.назначения.items).toEqual([])
})

test('a red flag the doctor stated is carried through verbatim', () => {
  const card = parseMedCard(JSON.stringify(completeCard))

  expect(card.красные_флаги.текст).toBe('Затруднённое дыхание, температура выше 39.5')
  expect(card.красные_флаги.цитата).toBe('если тяжело дышать — сразу скорую')
})

test('красные_флаги the doctor never mentioned backfills to null, not the empty-section placeholder', () => {
  const { красные_флаги: _omitted, ...partial } = completeCard
  const card = parseMedCard(JSON.stringify(partial))

  // Must not become MED_CARD_EMPTY_SECTION: that wording reads as a checked
  // and clear answer, a different, stronger claim than "not asked".
  expect(card.красные_флаги.текст).toBeNull()
  expect(card.красные_флаги.цитата).toBe('')
})

test('falls back to null when the model guesses an unknown visit type', () => {
  const card = parseMedCard(JSON.stringify({ ...completeCard, тип_приема: 'Неизвестный' }))

  expect(card.тип_приема).toBeNull()
})

test('rejects a completion with no JSON object', () => {
  expect(() => parseMedCard('Извините, не могу.')).toThrow(MedCardParseError)
})

test('rejects a truncated JSON object instead of returning a partial card', () => {
  expect(() => parseMedCard('{"жалобы": {"текст": "Боль"')).toThrow(MedCardParseError)
})
