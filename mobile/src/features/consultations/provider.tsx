import { createContext, useContext, type PropsWithChildren } from 'react';

import type { ConsultationsApi } from './api';

const ConsultationsContext = createContext<ConsultationsApi | null>(null);

export function ConsultationsProvider({
  api,
  children,
}: PropsWithChildren<{ api: ConsultationsApi }>) {
  return <ConsultationsContext.Provider value={api}>{children}</ConsultationsContext.Provider>;
}

export function useConsultationsApi() {
  const api = useContext(ConsultationsContext);
  if (!api) {
    throw new Error('useConsultationsApi must be used inside ConsultationsProvider');
  }
  return api;
}
