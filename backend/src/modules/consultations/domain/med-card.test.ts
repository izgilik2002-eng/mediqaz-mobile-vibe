import { expect, test } from 'bun:test'

import { MED_CARD_EMPTY_SECTION } from '@mediqaz/contracts'

import { MedCardParseError, parseMedCard } from './med-card'

const completeCard = {
  тип_приема: 'Первичный',
  жалобы: { текст: 'Боль в горле', цитата: 'горло болит' },
  анамнез: { текст: 'Болеет три дня', цитата: 'три дня' },
  объективно: { текст: 'Зев гиперемирован', цитата: 'зев красный' },
  диагноз: { текст: 'Острый фарингит', мкб10: 'J02.9', цитата: 'фарингит' },
  назначения: { текст: 'Полоскание 5 дней', цитата: 'полоскать' },
  рекомендации: { текст: 'Обильное питьё', цитата: 'пить больше' },
  следующий_прием: { текст: 'Через 5 дней', цитата: 'через пять дней' },
}

test('parses a bare JSON completion', () => {
  const card = parseMedCard(JSON.stringify(completeCard))

  expect(card.диагноз.мкб10).toBe('J02.9')
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

test('keeps a diagnosis without an ICD-10 code parseable but visibly empty', () => {
  const card = parseMedCard(
    JSON.stringify({ ...completeCard, диагноз: { текст: 'Фарингит', цитата: 'фарингит' } }),
  )

  expect(card.диагноз.мкб10).toBe('')
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
