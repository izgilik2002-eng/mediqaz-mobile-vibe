import { SymbolView } from 'expo-symbols';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/dashboard';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';

export default function AppointmentScreen() {
  const theme = useUiTheme();
  const insets = useSafeAreaInsets();

  // TEMPORARY diagnostic for the clipped tab-bar labels. Remove once the cause
  // is confirmed on a real device.
  const tabBarHeight = 56 + Math.max(insets.bottom, theme.spacing.sm);
  const contentBox = tabBarHeight - theme.spacing.sm - Math.max(insets.bottom, theme.spacing.sm);

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

      <Typography testID="debug.insets" variant="bodySm">
        {[
          `platform=${Platform.OS}`,
          `insets.bottom=${insets.bottom}`,
          `insets.top=${insets.top}`,
          `tabBarHeight=${tabBarHeight}`,
          `contentBox=${contentBox}`,
          `itemPadding=${theme.spacing.xs * 2}`,
          `usable=${contentBox - theme.spacing.xs * 2}`,
        ].join('\n')}
      </Typography>
    </ScreenShell>
  );
}
