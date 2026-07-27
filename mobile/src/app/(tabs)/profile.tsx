import { AccountSummary, ScreenShell } from '@/components/dashboard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TEST_IDS } from '@/constants/testIds';
import {
  AuthSessionErrorNotice,
  SessionControls,
  useAuth,
} from '@/features/auth';
import { SpecialtySection, useProfile } from '@/features/users';

export default function ProfileScreen() {
  const auth = useAuth();
  const profile = useProfile();

  if (!auth.user) return null;

  return (
    <ScreenShell
      description="Проверьте свои данные и специальность, от которой зависит медкарта."
      eyebrow="Аккаунт"
      testID={TEST_IDS.profile.screen}
      title="Профиль">
      <AccountSummary
        badge={auth.user.role === 'admin' ? 'Admin' : 'Врач'}
        description={`В MediQaz с ${formatAccountDate(auth.user.createdAt)}`}
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

      <SessionControls
        isLoggingOut={auth.isTransitioning}
        onLogout={() => void auth.logout().catch(() => undefined)}
      />
    </ScreenShell>
  );
}

function formatAccountDate(createdAt: string) {
  return new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(createdAt));
}
