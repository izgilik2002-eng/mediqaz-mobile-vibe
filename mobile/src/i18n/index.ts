import { getLocales } from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import kk from './kk.json';
import {
  DEFAULT_LANGUAGE,
  resolveDeviceLanguage,
  type AppLanguage,
} from './language';
import ru from './ru.json';

export {
  DEFAULT_LANGUAGE,
  isAppLanguage,
  KAZAKH_TRANSLATION_READY,
  resolveDeviceLanguage,
  SUPPORTED_LANGUAGES,
  type AppLanguage,
} from './language';

export function deviceLanguage(): AppLanguage {
  return resolveDeviceLanguage(getLocales());
}

export function initI18n(language: AppLanguage = deviceLanguage()) {
  if (i18next.isInitialized) return i18next;

  void i18next.use(initReactI18next).init({
    resources: {
      ru: { translation: ru },
      kk: { translation: kk },
    },
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    // Kazakh values are still Russian placeholders, so an untranslated key must
    // fall through to Russian instead of rendering the key itself.
    returnEmptyString: false,
    interpolation: { escapeValue: false },
  });

  return i18next;
}

export default i18next;
