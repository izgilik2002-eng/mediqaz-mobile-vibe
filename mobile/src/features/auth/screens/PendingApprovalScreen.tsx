import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ScreenShell, SectionCard } from '@/components/dashboard';
import { ScreenLoader } from '@/components/screen-states';
import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import { SessionControls } from '../components/session-controls';
import { useDoctorAccess } from '../access';
import { useAuth } from '../provider';

/**
 * Shown while an administrator has not cleared the account yet. Approval
 * happens outside the app, so the doctor gets an explicit re-check instead of
 * having to force-quit and reopen to notice it landed.
 */
export function PendingApprovalScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const access = useDoctorAccess();
  const [isChecking, setIsChecking] = useState(false);

  if (access.state === 'loading') {
    return <ScreenLoader />;
  }

  if (access.state === 'signed-out') {
    return <Redirect href="/" />;
  }

  if (access.state === 'allowed') {
    return <Redirect href="/appointment" />;
  }

  const recheck = async () => {
    setIsChecking(true);
    try {
      await auth.refreshUser();
    } catch {
      // A failed re-check leaves the doctor on this screen, which is already
      // the correct state; the button simply becomes available again.
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <ScreenShell
      description={t('approval.description')}
      eyebrow={t('approval.eyebrow')}
      testID={TEST_IDS.approval.screen}
      title={t('approval.title')}>
      <SectionCard
        description={t('approval.statusDescription')}
        testID={TEST_IDS.approval.status}
        title={t('approval.statusTitle')}>
        <Typography muted testID={TEST_IDS.approval.email} variant="bodySm">
          {access.user.email}
        </Typography>
        <Button
          disabled={isChecking}
          loading={isChecking}
          testID={TEST_IDS.approval.recheckButton}
          onPress={() => void recheck()}>
          {t('approval.recheck')}
        </Button>
      </SectionCard>

      <SessionControls
        isLoggingOut={auth.isTransitioning}
        onLogout={() => void auth.logout().catch(() => undefined)}
      />
    </ScreenShell>
  );
}
