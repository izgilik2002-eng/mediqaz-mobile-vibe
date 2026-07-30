import { expect, test } from 'bun:test';

import {
  extractVoiceCommand,
  findQuoteTimestamps,
  normalizeText,
} from '../src/features/consultations/transcript';

test('normalizeText strips punctuation and collapses whitespace', () => {
  expect(normalizeText('  Горло,  БОЛИТ!  ')).toBe('горло болит');
  expect(normalizeText('«Кашель» — сухой.')).toBe('кашель сухой');
});

test('extracts the command spoken after the wake word', () => {
  expect(extractVoiceCommand('медиказ добавь направление к лору')).toBe(
    'добавь направление к лору',
  );
});

test('keeps the command verbatim, with its punctuation and case', () => {
  expect(extractVoiceCommand('Медиказ, добавь: Амоксициллин 500 мг.')).toBe(
    'добавь: Амоксициллин 500 мг.',
  );
});

test('recognises the wake word in mid-sentence and common misrecognitions', () => {
  expect(extractVoiceCommand('так, медиказ запиши повторный приём')).toBe(
    'запиши повторный приём',
  );
  expect(extractVoiceCommand('медикас укажи аллергию на пенициллин')).toBe(
    'укажи аллергию на пенициллин',
  );
  expect(extractVoiceCommand('mediqaz add allergy note')).toBe('add allergy note');
});

test('returns null for ordinary consultation speech', () => {
  expect(extractVoiceCommand('на что жалуетесь сегодня')).toBeNull();
  expect(extractVoiceCommand('')).toBeNull();
});

test('ignores a wake word with nothing meaningful after it', () => {
  expect(extractVoiceCommand('медиказ')).toBeNull();
  expect(extractVoiceCommand('медиказ ок')).toBeNull();
});

const timedWords = [
  { word: 'пациент', start: 0, end: 0.5 },
  { word: 'жалуется', start: 0.5, end: 1 },
  { word: 'на', start: 1, end: 1.2 },
  { word: 'боль', start: 1.2, end: 1.6 },
  { word: 'в', start: 1.6, end: 1.7 },
  { word: 'горле', start: 1.7, end: 2.2 },
];

test('finds the audio interval behind a quote', () => {
  expect(findQuoteTimestamps('боль в горле', timedWords)).toEqual({ start: 1.2, end: 2.2 });
});

test('matches a quote regardless of punctuation and case', () => {
  expect(findQuoteTimestamps('«Боль, в Горле!»', timedWords)).toEqual({ start: 1.2, end: 2.2 });
});

test('returns null when the quote is absent or there is no timing data', () => {
  expect(findQuoteTimestamps('боль в спине', timedWords)).toBeNull();
  expect(findQuoteTimestamps('боль в горле', [])).toBeNull();
  expect(findQuoteTimestamps('', timedWords)).toBeNull();
  expect(findQuoteTimestamps('боль в горле', undefined)).toBeNull();
});

test('does not match a quote that runs past the end of the transcript', () => {
  expect(findQuoteTimestamps('в горле сильная', timedWords)).toBeNull();
});
