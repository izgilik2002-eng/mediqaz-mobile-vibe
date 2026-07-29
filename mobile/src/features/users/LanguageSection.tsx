import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SectionCard } from '@/components/dashboard';
import { UiPressable } from '@/components/ui/primitives';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import { isAppLanguage, KAZAKH_TRANSLATION_READY } from '@/i18n';
import { useLanguage } from '@/i18n/provider';

export function LanguageSection() {
  const { t } = useTranslation();
  const theme = useUiTheme();
  const { language, languages, setLanguage } = useLanguage();

  // Hidden until there is a second language worth choosing.
  if (!KAZAKH_TRANSLATION_READY) return null;

  return (
    <SectionCard
      description={t('profile.languageDescription')}
      testID={TEST_IDS.profile.languageSection}
      title={t('profile.languageTitle')}>
      <RadioGroup
        accessibilityLabel={t('profile.languageSelectLabel')}
        testID={TEST_IDS.profile.languageGroup}
        value={language}
        onValueChange={(value) => {
          if (isAppLanguage(value)) setLanguage(value);
        }}>
        {languages.map((code) => (
          <UiPressable
            accessibilityLabel={t(`language.${code}`)}
            key={code}
            style={[styles.option, { gap: theme.spacing.md, paddingVertical: theme.spacing.sm }]}
            testID={`${TEST_IDS.profile.languageOption}.${code}`}
            onPress={() => setLanguage(code)}>
            <RadioGroupItem accessibilityLabel={t(`language.${code}`)} value={code} />
            <Typography variant="body">{t(`language.${code}`)}</Typography>
          </UiPressable>
        ))}
      </RadioGroup>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  option: {
    alignItems: 'center',
    flexDirection: 'row',
  },
});
