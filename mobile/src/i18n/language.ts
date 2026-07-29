export const SUPPORTED_LANGUAGES = ['ru', 'kk'] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: AppLanguage = 'ru';

/**
 * Kazakh dictionary values are still Russian placeholders, so the switcher stays
 * hidden: shipping it would advertise a language the app cannot actually show.
 * Flip this once kk.json holds real Kazakh — a test refuses the flag otherwise.
 */
export const KAZAKH_TRANSLATION_READY = false;

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return SUPPORTED_LANGUAGES.includes(value as AppLanguage);
}

/**
 * Picks the first device language the app actually ships. Falls back to Russian
 * rather than to a device language nobody translated, so a doctor never lands
 * on raw keys.
 *
 * Kept free of expo and react-native imports so the rule stays testable.
 */
export function resolveDeviceLanguage(
  locales: readonly { languageCode: string | null }[],
): AppLanguage {
  for (const locale of locales) {
    if (isAppLanguage(locale.languageCode)) return locale.languageCode;
  }
  return DEFAULT_LANGUAGE;
}
