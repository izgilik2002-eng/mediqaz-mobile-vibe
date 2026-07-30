import { describe, expect, test } from 'bun:test'

import {
  askAboutConsultationRequestSchema,
  doctorSpecialtySchema,
  generateMedCardRequestSchema,
  medCardSchema,
  MED_CARD_SECTIONS,
  SPECIALTY_NAMES,
  startAppointmentRequestSchema,
} from './index'

const medCard = {
  тип_приема: 'Первичный',
  жалобы: { текст: 'Боль в горле третий день', цитата: 'горло болит третий день' },
  анамнез: { текст: 'Не указано в ходе приёма', цитата: '' },
  объективно: { текст: 'Зев гиперемирован', цитата: 'зев красный' },
  диагноз: { текст: 'Острый фарингит', мкб10: 'J02.9', цитата: 'похоже на фарингит' },
  назначения: { текст: 'Полоскание 4 раза в день, 5 дней', цитата: 'полоскать четыре раза' },
  рекомендации: { текст: 'Обильное питьё', цитата: 'пейте больше' },
  следующий_прием: { текст: 'Через 5 дней', цитата: 'приходите через пять дней' },
} as const

describe('consultation contracts', () => {
  test('every med-card section key is present in the med-card schema', () => {
    expect(medCardSchema.parse(medCard)).toEqual(medCard)

    for (const { key } of MED_CARD_SECTIONS) {
      const withoutSection = { ...medCard } as Record<string, unknown>
      delete withoutSection[key]
      expect(() => medCardSchema.parse(withoutSection)).toThrow()
    }
  })

  test('only the diagnosis section carries an ICD-10 code', () => {
    expect(medCardSchema.parse(medCard).диагноз.мкб10).toBe('J02.9')
    expect(() =>
      medCardSchema.parse({
        ...medCard,
        диагноз: { текст: 'Острый фарингит', цитата: 'фарингит' },
      }),
    ).toThrow()
  })

  test('visit type is nullable because the model must not guess it', () => {
    expect(medCardSchema.parse({ ...medCard, тип_приема: null }).тип_приема).toBeNull()
    expect(() => medCardSchema.parse({ ...medCard, тип_приема: 'Неизвестный' })).toThrow()
  })

  test('every supported specialty has a display name', () => {
    for (const specialty of doctorSpecialtySchema.options) {
      expect(SPECIALTY_NAMES[specialty]).toBeTruthy()
    }
    expect(doctorSpecialtySchema.options).toHaveLength(6)
    expect(() => doctorSpecialtySchema.parse('dentist')).toThrow()
  })

  test('med-card generation requires a non-empty transcript and known specialty', () => {
    expect(
      generateMedCardRequestSchema.parse({
        transcript: '  доктор: на что жалуетесь  ',
      }),
    ).toEqual({ transcript: 'доктор: на что жалуетесь' })

    expect(() =>
      generateMedCardRequestSchema.parse({ transcript: '   ' }),
    ).toThrow()
  })

  test('patient name is optional and trimmed, but cannot be blank if present', () => {
    expect(startAppointmentRequestSchema.parse({})).toEqual({})
    expect(startAppointmentRequestSchema.parse({ patientName: '  Иванов И.И.  ' })).toEqual({
      patientName: 'Иванов И.И.',
    })
    expect(() => startAppointmentRequestSchema.parse({ patientName: '' })).toThrow()
    expect(() => startAppointmentRequestSchema.parse({ patientName: '   ' })).toThrow()
    expect(() => startAppointmentRequestSchema.parse({ patientName: 'я'.repeat(201) })).toThrow()
  })

  test('consultation questions are bounded and required', () => {
    expect(() =>
      askAboutConsultationRequestSchema.parse({
        transcript: 'приём',
        question: '',
      }),
    ).toThrow()
    expect(() =>
      askAboutConsultationRequestSchema.parse({
        transcript: 'приём',
        question: 'я'.repeat(2_001),
      }),
    ).toThrow()
  })
})
