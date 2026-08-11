import { describe, expect, test } from 'bun:test'

import {
  askAboutConsultationRequestSchema,
  DEFAULT_TRANSCRIPTION_LANGUAGE,
  doctorSpecialtySchema,
  generateMedCardRequestSchema,
  medCardSchema,
  MED_CARD_SECTIONS,
  SPECIALTY_NAMES,
  startAppointmentRequestSchema,
  transcriptionIsCapped,
  transcriptionLanguageSchema,
  type MedCard,
} from './index'

const medCard = {
  тип_приема: 'Первичный',
  жалобы: { текст: 'Боль в горле третий день', цитата: 'горло болит третий день' },
  анамнез: { текст: 'Не указано в ходе приёма', цитата: '' },
  объективно: { текст: 'Зев гиперемирован', цитата: 'зев красный' },
  диагноз_врача: { текст: 'Острый фарингит', мкб10: 'J02.9', цитата: 'похоже на фарингит' },
  назначения: {
    items: [
      {
        препарат: 'Парацетамол',
        доза: '500 мг',
        кратность: null,
        длительность: null,
        условие_приема: 'только при температуре выше 38.5',
        цитата: 'парацетамол если температура выше 38.5',
      },
    ],
  },
  красные_флаги: { текст: null, цитата: '' },
  рекомендации: { текст: 'Обильное питьё', цитата: 'пейте больше' },
  следующий_прием: { текст: 'Через 5 дней', цитата: 'приходите через пять дней' },
} satisfies MedCard

describe('consultation contracts', () => {
  test('every med-card section key is present in the med-card schema', () => {
    expect(medCardSchema.parse(medCard)).toEqual(medCard)

    for (const { key } of MED_CARD_SECTIONS) {
      const withoutSection = { ...medCard } as Record<string, unknown>
      delete withoutSection[key]
      expect(() => medCardSchema.parse(withoutSection)).toThrow()
    }
  })

  test("the doctor's diagnosis is nullable in both halves, and neither may be omitted", () => {
    // A doctor may state a diagnosis in words, name only a code, or neither.
    // Nullable rather than optional: an absent field is indistinguishable from
    // a rendering bug, while an explicit null says the doctor did not say it.
    expect(
      medCardSchema.parse({
        ...medCard,
        диагноз_врача: { текст: null, мкб10: null, цитата: '' },
      }).диагноз_врача.текст,
    ).toBeNull()

    expect(() =>
      medCardSchema.parse({
        ...medCard,
        диагноз_врача: { текст: 'Острый фарингит', цитата: 'фарингит' },
      }),
    ).toThrow()
  })

  test('a stray diagnostic guess the model attaches anyway is stripped, not validated through', () => {
    // The model is never asked for a diagnosis of its own — see prompts.ts —
    // but nothing stops a disobedient completion from attaching one anyway.
    // Zod strips unknown keys by default, so it must not survive parsing.
    const parsed = medCardSchema.parse({
      ...medCard,
      предположение_ai: { текст: 'Вирусный фарингит', мкб10: 'J02.9' },
    })

    expect(parsed).not.toHaveProperty('предположение_ai')
  })

  test('a prescription requires a drug name, but every other field is explicitly nullable', () => {
    expect(() =>
      medCardSchema.parse({
        ...medCard,
        назначения: { items: [{ ...medCard.назначения.items[0], препарат: undefined }] },
      }),
    ).toThrow()

    // Nullable, not optional: the model has to say "not specified" rather than
    // leave the field out, so a doctor reading the card cannot tell a real gap
    // apart from a rendering bug.
    expect(
      medCardSchema.parse({
        ...medCard,
        назначения: {
          items: [
            {
              препарат: 'Ибупрофен',
              доза: null,
              кратность: null,
              длительность: null,
              условие_приема: null,
              цитата: '',
            },
          ],
        },
      }).назначения.items[0]?.доза,
    ).toBeNull()
  })

  test('красные_флаги stays a mandatory field even though its text may be null', () => {
    // Present-but-null is a different, weaker claim than absent: absent could
    // mean the model forgot to ask, null means it asked and nothing came back.
    expect(
      medCardSchema.parse({ ...medCard, красные_флаги: { текст: null, цитата: '' } }).красные_флаги.текст,
    ).toBeNull()

    const { красные_флаги: _omitted, ...withoutRedFlags } = medCard
    expect(() => medCardSchema.parse(withoutRedFlags)).toThrow()
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

  test('only the whole-file languages are capped, so Russian keeps unlimited visits', () => {
    // Russian streams through a model with no processing budget. Capping it
    // would shorten consultations that work today, which is a regression no
    // error message makes acceptable.
    expect(transcriptionIsCapped('ru')).toBe(false)
    expect(transcriptionIsCapped('kk')).toBe(true)
    expect(transcriptionIsCapped('multi')).toBe(true)
  })

  test('the default transcription language is one the enum accepts', () => {
    // The Prisma column defaults to this value for every existing doctor, so a
    // drift between the two would silently break accounts on migration.
    expect(transcriptionLanguageSchema.parse(DEFAULT_TRANSCRIPTION_LANGUAGE)).toBe('ru')
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
