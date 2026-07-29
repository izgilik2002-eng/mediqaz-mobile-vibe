import { ApiRequestError } from './transport';

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Three-step fallback so a doctor never sees an untranslated raw code or an
 * empty string: translation by code -> the server's own message (covers a
 * code this app build has never seen, since the backend can ship ahead of
 * the app) -> a generic translated message.
 */
export function apiErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiRequestError) {
    return t(`errors.${error.code}`, { defaultValue: error.message });
  }
  return t('errors.INTERNAL_ERROR');
}
