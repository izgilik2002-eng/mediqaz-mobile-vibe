import { expect, test } from 'bun:test';

import kk from '../src/i18n/kk.json';
import ru from '../src/i18n/ru.json';
import {
  DEFAULT_LANGUAGE,
  isAppLanguage,
  KAZAKH_TRANSLATION_READY,
  resolveDeviceLanguage,
  SUPPORTED_LANGUAGES,
} from '../src/i18n/language';

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, nested]) =>
    flatten(nested, prefix ? `${prefix}.${key}` : key),
  );
}

test('both dictionaries expose exactly the same keys', () => {
  const ruKeys = flatten(ru).sort();
  const kkKeys = flatten(kk).sort();

  expect(kkKeys).toEqual(ruKeys);
  expect(ruKeys.length).toBeGreaterThan(0);
});

test('keys stay ASCII so a broken encoding cannot break lookups', () => {
  // TERMS.md rule: Cyrillic lives in values only. A mangled key is a silent
  // miss at runtime, a mangled value is merely visible.
  for (const key of flatten(ru)) {
    expect(key).toBe(Buffer.from(key, 'ascii').toString('ascii'));
  }
});

test('no translation value is left empty', () => {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      expect(value.trim(), `empty value at ${path}`).not.toBe('');
      return;
    }
    for (const [key, nested] of Object.entries(value as object)) {
      walk(nested, path ? `${path}.${key}` : key);
    }
  };
  walk(ru, '');
  walk(kk, '');
});

test('device language is used when the app ships it', () => {
  expect(resolveDeviceLanguage([{ languageCode: 'kk' }])).toBe('kk');
  expect(resolveDeviceLanguage([{ languageCode: 'ru' }])).toBe('ru');
});

test('an unsupported device language falls back to Russian, not to raw keys', () => {
  expect(resolveDeviceLanguage([{ languageCode: 'en' }])).toBe(DEFAULT_LANGUAGE);
  expect(resolveDeviceLanguage([{ languageCode: null }])).toBe(DEFAULT_LANGUAGE);
  expect(resolveDeviceLanguage([])).toBe(DEFAULT_LANGUAGE);
});

test('the first supported device language wins over later ones', () => {
  expect(
    resolveDeviceLanguage([{ languageCode: 'en' }, { languageCode: 'kk' }, { languageCode: 'ru' }]),
  ).toBe('kk');
});

test('only shipped languages are accepted from storage', () => {
  expect(isAppLanguage('ru')).toBe(true);
  expect(isAppLanguage('kk')).toBe(true);
  expect(isAppLanguage('en')).toBe(false);
  expect(isAppLanguage(null)).toBe(false);
  expect(SUPPORTED_LANGUAGES).toEqual(['ru', 'kk']);
});

test('every specialty the backend accepts has a label', () => {
  for (const specialty of [
    'therapist',
    'pediatrician',
    'cardiologist',
    'surgeon',
    'ent',
    'neurologist',
  ]) {
    expect(ru.specialty[specialty as keyof typeof ru.specialty]).toBeTruthy();
  }
});

test('the language switcher stays hidden while Kazakh is a Russian placeholder', () => {
  const identical = JSON.stringify(ru) === JSON.stringify(kk);

  if (KAZAKH_TRANSLATION_READY) {
    // Flipping the flag without translating would ship a switcher that changes
    // nothing a doctor can see.
    expect(identical, 'kk.json still matches ru.json').toBe(false);
  } else {
    expect(identical).toBe(true);
  }
});
