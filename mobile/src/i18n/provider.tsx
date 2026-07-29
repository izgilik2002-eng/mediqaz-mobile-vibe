import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { I18nextProvider } from 'react-i18next';

import i18n, {
  DEFAULT_LANGUAGE,
  initI18n,
  deviceLanguage,
  SUPPORTED_LANGUAGES,
  type AppLanguage,
} from './index';
import { getStoredLanguage, setStoredLanguage } from './language-store';

type LanguageContextValue = {
  language: AppLanguage;
  languages: readonly AppLanguage[];
  setLanguage: (language: AppLanguage) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  // Initialised synchronously with the device language so the first frame is
  // already translated; a stored preference overrides it once it is read.
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    const initial = deviceLanguage();
    initI18n(initial);
    return initial;
  });

  useEffect(() => {
    let isCancelled = false;

    void getStoredLanguage().then((stored) => {
      if (isCancelled || !stored || stored === language) return;
      void i18n.changeLanguage(stored);
      setLanguageState(stored);
    });

    return () => {
      isCancelled = true;
    };
    // Runs once: later changes go through setLanguage, which writes the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    void i18n.changeLanguage(next);
    void setStoredLanguage(next);
  }, []);

  const value = useMemo(
    () => ({ language, languages: SUPPORTED_LANGUAGES, setLanguage }),
    [language, setLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used inside LanguageProvider');
  }
  return context;
}

export { DEFAULT_LANGUAGE };
