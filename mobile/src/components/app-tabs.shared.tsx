import {
  Tabs as RouterTabs,
} from 'expo-router';
import type { BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { PlatformPressable } from 'expo-router/react-navigation';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography } from '@/components/ui/typography';
import { useUiTheme } from '@/components/ui/theme';
import { TEST_IDS } from '@/constants/testIds';

export default function AppTabs() {
  const { t } = useTranslation();
  const theme = useUiTheme();
  const insets = useSafeAreaInsets();
  // 64 leaves room for the icon, the gap the navigator puts under it, and the
  // caption line height once the bar's own vertical padding is taken out.
  const tabBarHeight = 64 + Math.max(insets.bottom, theme.spacing.sm);

  return (
    <RouterTabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.background },
        tabBarActiveTintColor: theme.colors.foreground,
        tabBarActiveBackgroundColor: theme.colors.accent,
        tabBarButton: NativeTabButton,
        tabBarHideOnKeyboard: true,
        tabBarInactiveBackgroundColor: theme.colors.transparent,
        tabBarInactiveTintColor: theme.colors.mutedForeground,
        tabBarItemStyle: {
          borderRadius: theme.radius.lg,
          marginHorizontal: theme.spacing.xs,
          paddingVertical: theme.spacing.xs,
        },
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: theme.colors.background,
            borderTopColor: theme.colors.border,
            height: tabBarHeight,
            paddingBottom: Math.max(insets.bottom, theme.spacing.sm),
            paddingTop: theme.spacing.sm,
          },
        ],
      }}>
      <RouterTabs.Screen
        name="appointment"
        options={{
          title: t('tabs.appointment'),
          tabBarLabel: ({ color }) => (
            <Typography colorValue={color} variant="caption" weight="700">
              {t('tabs.appointment')}
            </Typography>
          ),
          tabBarButtonTestID: TEST_IDS.tabs.appointmentTab,
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'mic.fill', android: 'mic', web: 'mic' }}
              size={size}
              tintColor={color}
            />
          ),
        }}
      />
      <RouterTabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarLabel: ({ color }) => (
            <Typography colorValue={color} variant="caption" weight="700">
              {t('tabs.profile')}
            </Typography>
          ),
          tabBarButtonTestID: TEST_IDS.tabs.profileTab,
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'person.crop.circle.fill', android: 'person', web: 'person' }}
              size={size}
              tintColor={color}
            />
          ),
        }}
      />
    </RouterTabs>
  );
}

function NativeTabButton({
  style,
  ...props
}: BottomTabBarButtonProps) {
  const theme = useUiTheme();

  return (
    <PlatformPressable
      {...props}
      pressOpacity={theme.opacity.pressed}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
    shadowOpacity: 0,
  },
});
