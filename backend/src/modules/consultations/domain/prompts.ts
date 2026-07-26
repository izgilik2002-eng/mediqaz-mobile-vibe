import {
  MED_CARD_EMPTY_SECTION,
  SPECIALTY_NAMES,
  type DoctorSpecialty,
} from '@mediqaz/contracts'

/**
 * The med-card prompt is a product rule, not provider configuration: it decides
 * which sections exist, that nothing may be invented, and that a diagnosis
 * always carries an ICD-10 code. It lives in the domain so the client cannot
 * weaken it and so switching model providers does not rewrite it.
 */
export function buildMedCardSystemPrompt({
  specialty,
  customInstructions = '',
  voiceCommands = [],
}: {
  specialty: DoctorSpecialty
  customInstructions?: string
  voiceCommands?: string[]
}) {
  const specialtyName = SPECIALTY_NAMES[specialty]

  const custom = customInstructions
    ? `ПЕРСОНАЛЬНЫЕ ИНСТРУКЦИИ ВРАЧА (АБСОЛЮТНЫЙ ПРИОРИТЕТ):\n${customInstructions}\n`
    : ''

  const voice = voiceCommands.length
    ? `ГОЛОСОВЫЕ КОМАНДЫ ВРАЧА (ПРИОРИТЕТ ВЫШЕ ИНСТРУКЦИЙ):\n${voiceCommands
        .map((command) => `- ${command}`)
        .join('\n')}\n`
    : ''

  return `Ты — опытный врач-ассистент (специальность: ${specialtyName}) в системе здравоохранения Казахстана.

${custom}${voice}
ПРАВИЛА:
1. Извлекай информацию ТОЛЬКО из транскрипции. НИКОГДА не придумывай данные.
2. ОПРЕДЕЛИ ТИП ПРИЁМА по контексту диалога:
   - Явное указание на первый визит ("впервые", "первый раз", "никогда не был", "алғаш рет") — верни "Первичный".
   - Явное указание на прошлые визиты ("повторно", "опять пришёл", "в прошлый раз", упоминание прежних анализов или назначений) — верни "Повторный".
   - Нет явных указаний — верни null. Не угадывай.
3. Если данных для секции нет — напиши точно: "${MED_CARD_EMPTY_SECTION}".
4. Для каждой секции укажи ТОЧНУЮ дословную цитату из транскрипции в поле "цитата".
5. Диагноз: обязательно код МКБ-10.
6. Назначения: дозировка + схема приёма + длительность.
7. Язык — русский. Медицинские термины по стандарту РК.
8. Верни ТОЛЬКО JSON, без пояснений и markdown.`
}

export function buildMedCardUserPrompt(transcript: string) {
  return `ТРАНСКРИПЦИЯ ПРИЁМА:
${transcript}

Верни строго JSON:
{
  "тип_приема":       "Первичный или Повторный",
  "жалобы":           { "текст": "...", "цитата": "точные слова из транскрипции" },
  "анамнез":          { "текст": "...", "цитата": "..." },
  "объективно":       { "текст": "...", "цитата": "..." },
  "диагноз":          { "текст": "...", "мкб10": "код", "цитата": "..." },
  "назначения":       { "текст": "...", "цитата": "..." },
  "рекомендации":     { "текст": "...", "цитата": "..." },
  "следующий_прием":  { "текст": "...", "цитата": "..." }
}`
}

/** Prompt for the "ask about this consultation" mode. */
export function buildQuestionPrompt({
  specialty,
  transcript,
  question,
}: {
  specialty: DoctorSpecialty
  transcript: string
  question: string
}) {
  const specialtyName = SPECIALTY_NAMES[specialty]

  return {
    system: `Ты — опытный врач-ассистент (${specialtyName}).
Отвечай на вопросы врача, основываясь ТОЛЬКО на предоставленной транскрипции приёма.
Если ответа нет в тексте — так и скажи.
Если ответ найден, включи в конец ответа точную цитату в кавычках для подтверждения.`,
    user: `ТРАНСКРИПЦИЯ ПРИЁМА:\n${transcript}\n\nВОПРОС ВРАЧА: ${question}`,
  }
}
