import { useTranslation } from 'react-i18next';

import { SectionCard } from '@/components/dashboard/SectionCard';
import { Button } from '@/components/ui/button';
import { TEST_IDS } from '@/constants/testIds';

type SessionControlsProps = {
  isLoggingOut: boolean;
  onLogout: () => void;
};

export function SessionControls({
  isLoggingOut,
  onLogout,
}: SessionControlsProps) {
  const { t } = useTranslation();

  return (
    <SectionCard
      description={t('auth.sessionCardDescription')}
      title={t('auth.sessionCardTitle')}>
      <Button
        disabled={isLoggingOut}
        loading={isLoggingOut}
        testID={TEST_IDS.auth.logoutButton}
        variant="outline"
        onPress={onLogout}>
        {t('auth.logout')}
      </Button>
    </SectionCard>
  );
}
