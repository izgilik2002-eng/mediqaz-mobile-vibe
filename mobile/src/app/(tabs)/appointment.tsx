import { SymbolView } from 'expo-symbols';

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
  const theme = useUiTheme();

  return (
    <ScreenShell
      eyebrow="MediQaz"
      testID={TEST_IDS.appointment.screen}
      title="Приём">
      <Empty testID={TEST_IDS.appointment.placeholder}>
        <EmptyHeader>
          <EmptyMedia>
            <SymbolView
              name={{ ios: 'mic.fill', android: 'mic', web: 'mic' }}
              size={32}
              tintColor={theme.colors.mutedForeground}
            />
          </EmptyMedia>
          <EmptyTitle>Скоро здесь появится запись приёма</EmptyTitle>
          <EmptyDescription>
            Вы сможете записать приём, а ассистент составит медкарту.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </ScreenShell>
  );
}
