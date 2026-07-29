import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';

import { ScreenShell } from '@/components/dashboard';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { useUiTheme } from '@/components/ui/theme';
import { TEST_IDS } from '@/constants/testIds';

export default function AppointmentScreen() {
  const { t } = useTranslation();
  const theme = useUiTheme();

  return (
    <ScreenShell
      eyebrow={t('appointment.eyebrow')}
      testID={TEST_IDS.appointment.screen}
      title={t('appointment.title')}>
      <Empty testID={TEST_IDS.appointment.placeholder}>
        <EmptyHeader>
          <EmptyMedia>
            <SymbolView
              name={{ ios: 'mic.fill', android: 'mic', web: 'mic' }}
              size={32}
              tintColor={theme.colors.mutedForeground}
            />
          </EmptyMedia>
          <EmptyTitle>{t('appointment.placeholderTitle')}</EmptyTitle>
          <EmptyDescription>
            {t('appointment.placeholderDescription')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </ScreenShell>
  );
}
