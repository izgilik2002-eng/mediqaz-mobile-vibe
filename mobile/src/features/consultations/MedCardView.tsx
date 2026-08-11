import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import {
  MED_CARD_SECTIONS,
  type MedCard,
  type MedCardSectionKey,
  type PrescriptionItem,
} from '@mediqaz/contracts';

import { DataRow, SectionCard } from '@/components/dashboard';
import { Surface } from '@/components/ui/primitives';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';

// Maps the backend's Cyrillic section keys to ASCII i18n keys — TERMS.md rule:
// code stays ASCII, Cyrillic lives only in translated values.
const SECTION_TRANSLATION_KEYS: Record<MedCardSectionKey, string> = {
  жалобы: 'complaints',
  анамнез: 'anamnesis',
  объективно: 'objective',
  диагноз_врача: 'doctorDiagnosis',
  назначения: 'prescriptions',
  красные_флаги: 'redFlags',
  рекомендации: 'recommendations',
  следующий_прием: 'nextVisit',
};

type MedCardViewProps = {
  medCard: MedCard;
};

export function MedCardView({ medCard }: MedCardViewProps) {
  const { t } = useTranslation();

  return (
    <Fragment>
      {MED_CARD_SECTIONS.map(({ key }) => (
        <SectionCard
          key={key}
          testID={`${TEST_IDS.appointment.medCard.section}.${key}`}
          title={t(`medcard.${SECTION_TRANSLATION_KEYS[key]}`)}>
          {key === 'назначения' ? (
            <PrescriptionsSection items={medCard.назначения.items} />
          ) : key === 'красные_флаги' ? (
            <RedFlagsSection text={medCard.красные_флаги.текст} />
          ) : key === 'диагноз_врача' ? (
            <DoctorDiagnosisSection diagnosis={medCard.диагноз_врача} />
          ) : (
            <Typography variant="body">{medCard[key].текст}</Typography>
          )}
        </SectionCard>
      ))}
    </Fragment>
  );
}

/**
 * The doctor's own diagnosis, rendered plainly like any other recorded finding.
 * When nothing was stated the section says so outright rather than falling
 * silent, because an empty card here is indistinguishable from a rendering
 * failure — and this is the section that becomes the official entry.
 */
function DoctorDiagnosisSection({ diagnosis }: { diagnosis: MedCard['диагноз_врача'] }) {
  const { t } = useTranslation();

  if (diagnosis.текст === null && diagnosis.мкб10 === null) {
    return (
      <Typography muted testID={TEST_IDS.appointment.medCard.diagnosisMissing} variant="body">
        {t('medcard.diagnosisNotStated')}
      </Typography>
    );
  }

  return (
    <>
      <Typography variant="body">
        {diagnosis.текст ?? t('medcard.diagnosisCodeOnly')}
      </Typography>
      {diagnosis.мкб10 !== null && (
        <DataRow label={t('medcard.icd10')} value={diagnosis.мкб10} />
      )}
    </>
  );
}

/**
 * Each prescription renders every field the schema requires — including the
 * ones the doctor left unspecified — rather than only the ones with a value.
 * Hiding a blank "условие приёма" would look identical to there being no
 * condition at all, which is exactly the ambiguity the structured schema
 * exists to remove.
 */
function PrescriptionsSection({ items }: { items: PrescriptionItem[] }) {
  const { t } = useTranslation();
  const theme = useUiTheme();

  if (items.length === 0) {
    return (
      <Typography muted testID={TEST_IDS.appointment.medCard.noPrescriptions} variant="body">
        {t('medcard.noPrescriptions')}
      </Typography>
    );
  }

  const notSpecified = t('medcard.notSpecified');

  return (
    <View style={{ gap: theme.spacing.md }}>
      {items.map((item, index) => (
        <Surface
          bordered
          key={`${item.препарат}-${index}`}
          padded
          rounded="lg"
          testID={`${TEST_IDS.appointment.medCard.prescription}.${index}`}
          tone="muted">
          <Typography variant="bodySm" weight="700">
            {item.препарат}
          </Typography>
          <DataRow label={t('medcard.dose')} value={item.доза ?? notSpecified} />
          <DataRow label={t('medcard.frequency')} value={item.кратность ?? notSpecified} />
          <DataRow label={t('medcard.duration')} value={item.длительность ?? notSpecified} />
          <DataRow label={t('medcard.condition')} value={item.условие_приема ?? notSpecified} />
        </Surface>
      ))}
    </View>
  );
}

/**
 * `null` reads as "the doctor was not asked", not as "checked, nothing found"
 * — the two must look different on screen, or a doctor skimming the card
 * could mistake an unasked question for an answered one.
 */
function RedFlagsSection({ text }: { text: string | null }) {
  const { t } = useTranslation();

  if (text === null) {
    return (
      <Typography muted testID={TEST_IDS.appointment.medCard.redFlagsMissing} variant="body">
        {t('medcard.redFlagsNotMentioned')}
      </Typography>
    );
  }

  return <Typography variant="body">{text}</Typography>;
}
