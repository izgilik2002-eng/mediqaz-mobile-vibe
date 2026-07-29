import { useTranslation } from 'react-i18next';

import { DEFAULT_LANGUAGE, isAppLanguage } from './language';

/**
 * Dates follow the language the doctor chose in the app, not the device locale
 * and not a hardcoded one. Those two used to disagree: the profile forced `ru`
 * while the calendar followed the system, so one screen could read in Russian
 * while another read in whatever the phone was set to.
 */
export function formatDate(
  value: Date | string,
  language: string,
  options: Intl.DateTimeFormatOptions,
) {
  const locale = isAppLanguage(language) ? language : DEFAULT_LANGUAGE;
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function useDateFormat() {
  const { i18n } = useTranslation();

  return (value: Date | string, options: Intl.DateTimeFormatOptions) =>
    formatDate(value, i18n.language, options);
}
