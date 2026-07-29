import { useTranslation } from 'react-i18next';

import { AccountSummary, ScreenShell } from '@/components/dashboard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TEST_IDS } from '@/constants/testIds';
import {
  AuthSessionErrorNotice,
  SessionControls,
  useAuth,
} from '@/features/auth';
import { LanguageSection, SpecialtySection, useProfile } from '@/features/users';
import { useDateFormat } from '@/i18n/format';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const auth = useAuth();
  const profile = useProfile();

  if (!auth.user) return null;

  return (
    <ScreenShell
      description={t('profile.description')}
      eyebrow={t('profile.eyebrow')}
      testID={TEST_IDS.profile.screen}
      title={t('profile.title')}>
      <AccountSummary
        badge={auth.user.role === 'admin' ? t('profile.badgeAdmin') : t('profile.badgeDoctor')}
        description={t('profile.memberSince', {
          date: formatDate(auth.user.createdAt, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
        })}
        displayName={auth.user.displayName}
        email={auth.user.email}
      />

      <AuthSessionErrorNotice />

      {profile.error ? (
        <Alert testID={TEST_IDS.profile.specialtyError} variant="destructive">
          <AlertDescription>{profile.error}</AlertDescription>
        </Alert>
      ) : null}

      <SpecialtySection
        isSaving={profile.isSaving}
        user={auth.user}
        onSave={(specialty) => void profile.saveSpecialty(specialty)}
      />

      <LanguageSection />

      <SessionControls
        isLoggingOut={auth.isTransitioning}
        onLogout={() => void auth.logout().catch(() => undefined)}
      />
    </ScreenShell>
  );
}
