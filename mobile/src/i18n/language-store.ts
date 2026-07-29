import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { isAppLanguage, type AppLanguage } from './language';

const languageKey = 'mediqaz_language';

/**
 * The chosen language is a preference, not a credential, but it rides the same
 * storage the app already uses so no extra dependency is needed for one value.
 */
export async function getStoredLanguage(): Promise<AppLanguage | null> {
  try {
    const stored =
      Platform.OS === 'web'
        ? globalThis.localStorage?.getItem(languageKey) ?? null
        : await SecureStore.getItemAsync(languageKey);

    return isAppLanguage(stored) ? stored : null;
  } catch {
    // A device that refuses storage still gets the device language.
    return null;
  }
}

export async function setStoredLanguage(language: AppLanguage): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(languageKey, language);
      return;
    }
    await SecureStore.setItemAsync(languageKey, language);
  } catch {
    // Losing the preference is survivable; the switch still applies this run.
  }
}
