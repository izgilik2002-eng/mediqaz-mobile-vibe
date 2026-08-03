import type { DoctorSpecialty, TranscriptionLanguage } from '@mediqaz/contracts';
import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';

import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth';
import { apiErrorMessage, ApiRequestError } from '@/platform/api';
import type { UsersApi } from './api';

type ProfileContextValue = {
  error: string | null;
  isSaving: boolean;
  saveSpecialty: (specialty: DoctorSpecialty) => Promise<boolean>;
  saveTranscriptionLanguage: (language: TranscriptionLanguage) => Promise<boolean>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({
  api,
  children,
}: PropsWithChildren<{ api: Pick<UsersApi, 'updateProfile'> }>) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveSpecialty = useCallback(
    async (specialty: DoctorSpecialty) => {
      setIsSaving(true);
      setError(null);

      try {
        // displayName is part of the profile contract, so the current value is
        // sent back unchanged rather than being cleared as a side effect.
        await api.updateProfile({
          displayName: auth.user?.displayName ?? null,
          specialty,
        });
        // The cached user is the source of truth for the specialty gate, so it
        // is refreshed before reporting success.
        await auth.refreshUser();
        return true;
      } catch (caughtError) {
        setError(
          caughtError instanceof ApiRequestError
            ? apiErrorMessage(caughtError, t)
            : t('profile.specialtySaveFailed'),
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [api, auth, t],
  );

  const saveTranscriptionLanguage = useCallback(
    async (transcriptionLanguage: TranscriptionLanguage) => {
      setIsSaving(true);
      setError(null);

      try {
        await api.updateProfile({
          displayName: auth.user?.displayName ?? null,
          transcriptionLanguage,
        });
        // The cached user drives which languages the recording screen allows,
        // so it is refreshed before reporting success.
        await auth.refreshUser();
        return true;
      } catch (caughtError) {
        setError(
          caughtError instanceof ApiRequestError
            ? apiErrorMessage(caughtError, t)
            : t('profile.transcriptionLanguageSaveFailed'),
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [api, auth, t],
  );

  const value = useMemo(
    () => ({ error, isSaving, saveSpecialty, saveTranscriptionLanguage }),
    [error, isSaving, saveSpecialty, saveTranscriptionLanguage],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error('useProfile must be used inside ProfileProvider');
  }
  return context;
}
