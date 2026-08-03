import {
  transcriptionLanguageSchema,
  type TranscriptionLanguage,
  type UserDto,
} from '@mediqaz/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { SectionCard } from '@/components/dashboard';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { UiPressable } from '@/components/ui/primitives';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';

const LANGUAGES = transcriptionLanguageSchema.options;

type TranscriptionLanguageSectionProps = {
  isSaving: boolean;
  onSave: (language: TranscriptionLanguage) => void;
  user: UserDto;
};

/**
 * The doctor picks a language, never a model. Which provider serves each choice
 * is decided on the backend, so a provider swap changes nothing on this screen.
 *
 * Each option carries its own caveat rather than one generic note: only some of
 * them lose live transcription, and only some are capped in length, so a shared
 * footnote would be wrong for whichever option the doctor is reading.
 */
export function TranscriptionLanguageSection({
  isSaving,
  onSave,
  user,
}: TranscriptionLanguageSectionProps) {
  const { t } = useTranslation();
  const theme = useUiTheme();
  const [selected, setSelected] = useState<TranscriptionLanguage>(user.transcriptionLanguage);
  const hasChanged = selected !== user.transcriptionLanguage;

  return (
    <SectionCard
      description={t('profile.transcriptionLanguageDescription')}
      testID={TEST_IDS.profile.transcriptionLanguageSection}
      title={t('profile.transcriptionLanguageTitle')}>
      <RadioGroup
        accessibilityLabel={t('profile.transcriptionLanguageSelectLabel')}
        disabled={isSaving}
        testID={TEST_IDS.profile.transcriptionLanguageGroup}
        value={selected}
        onValueChange={(value) => {
          const parsed = transcriptionLanguageSchema.safeParse(value);
          if (parsed.success) setSelected(parsed.data);
        }}>
        {LANGUAGES.map((language) => (
          <UiPressable
            accessibilityLabel={t(`transcriptionLanguage.${language}`)}
            disabled={isSaving}
            key={language}
            style={[styles.option, { gap: theme.spacing.md, paddingVertical: theme.spacing.sm }]}
            testID={`${TEST_IDS.profile.transcriptionLanguageOption}.${language}`}
            onPress={() => setSelected(language)}>
            <RadioGroupItem
              accessibilityLabel={t(`transcriptionLanguage.${language}`)}
              disabled={isSaving}
              value={language}
            />
            <Typography style={styles.label} variant="body">
              {t(`transcriptionLanguage.${language}`)}
              {'\n'}
              <Typography muted variant="caption">
                {t(`transcriptionLanguage.${language}Hint`)}
              </Typography>
            </Typography>
          </UiPressable>
        ))}
      </RadioGroup>

      <Button
        disabled={!hasChanged || isSaving}
        loading={isSaving}
        testID={TEST_IDS.profile.transcriptionLanguageSaveButton}
        onPress={() => onSave(selected)}>
        {t('profile.transcriptionLanguageSave')}
      </Button>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  label: {
    flex: 1,
  },
  option: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
});
