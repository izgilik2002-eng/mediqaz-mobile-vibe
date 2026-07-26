import { AccountSummary, ScreenShell } from '@/components/dashboard';
import { TEST_IDS } from '@/constants/testIds';
import {
  AuthSessionErrorNotice,
  SessionControls,
  useAuth,
} from '@/features/auth';

export default function ProfileScreen() {
  const auth = useAuth();

  if (!auth.user) return null;

  return (
    <ScreenShell
      description="Review your identity and current device session."
      eyebrow="Account"
      testID={TEST_IDS.profile.screen}
      title="Profile">
      <AccountSummary
        badge={auth.user.role === 'admin' ? 'Admin' : 'User'}
        description={`Member since ${formatAccountDate(auth.user.createdAt)}`}
        displayName={auth.user.displayName}
        email={auth.user.email}
      />

      <AuthSessionErrorNotice />

      <SessionControls
        isLoggingOut={auth.isTransitioning}
        onLogout={() => void auth.logout().catch(() => undefined)}
      />
    </ScreenShell>
  );
}

function formatAccountDate(createdAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(createdAt));
}
