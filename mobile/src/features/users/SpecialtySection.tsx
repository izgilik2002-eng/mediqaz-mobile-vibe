import {
  doctorSpecialtySchema,
  type DoctorSpecialty,
  type UserDto,
} from '@mediqaz/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { SectionCard } from '@/components/dashboard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import { UiPressable } from '@/components/ui/primitives';

const SPECIALTIES = doctorSpecialtySchema.options;

type SpecialtySectionProps = {
  isSaving: boolean;
  onSave: (specialty: DoctorSpecialty) => void;
  user: UserDto;
};

/**
 * Every option is visible rather than hidden behind a dropdown: the choice
 * changes how the assistant writes med cards, so it should be a deliberate pick
 * and not whatever happened to be first in a collapsed list.
 */
export function SpecialtySection({ isSaving, onSave, user }: SpecialtySectionProps) {
  const { t } = useTranslation();
  const theme = useUiTheme();
  const [selected, setSelected] = useState<DoctorSpecialty | null>(user.specialty);
  const hasChanged = selected !== null && selected !== user.specialty;

  return (
    <SectionCard
      description={t('profile.specialtyDescription')}
      testID={TEST_IDS.profile.specialtySection}
      title={t('profile.specialtyTitle')}>
      {!user.specialty ? (
        <Alert testID={TEST_IDS.profile.specialtyMissing}>
          <AlertDescription>
            {t('profile.specialtyMissing')}
          </AlertDescription>
        </Alert>
      ) : null}

      <RadioGroup
        disabled={isSaving}
        testID={TEST_IDS.profile.specialtyGroup}
        value={selected ?? ''}
        onValueChange={(value) => {
          const parsed = doctorSpecialtySchema.safeParse(value);
          if (parsed.success) setSelected(parsed.data);
        }}
        accessibilityLabel={t('profile.specialtySelectLabel')}>
        {SPECIALTIES.map((specialty) => (
          <UiPressable
            accessibilityLabel={t(`specialty.${specialty}`)}
            disabled={isSaving}
            key={specialty}
            style={[styles.option, { gap: theme.spacing.md, paddingVertical: theme.spacing.sm }]}
            testID={`${TEST_IDS.profile.specialtyOption}.${specialty}`}
            onPress={() => setSelected(specialty)}>
            <RadioGroupItem
              accessibilityLabel={t(`specialty.${specialty}`)}
              disabled={isSaving}
              value={specialty}
            />
            <Typography variant="body">{t(`specialty.${specialty}`)}</Typography>
          </UiPressable>
        ))}
      </RadioGroup>

      <Button
        disabled={!hasChanged || isSaving}
        loading={isSaving}
        testID={TEST_IDS.profile.specialtySaveButton}
        onPress={() => {
          if (selected) onSave(selected);
        }}>
        {t('profile.specialtySave')}
      </Button>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  option: {
    alignItems: 'center',
    flexDirection: 'row',
  },
});
