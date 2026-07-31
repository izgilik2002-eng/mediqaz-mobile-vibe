import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { MED_CARD_SECTIONS, type MedCard, type MedCardSectionKey } from '@mediqaz/contracts';

import { DataRow, SectionCard } from '@/components/dashboard';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';

// Maps the backend's Cyrillic section keys to ASCII i18n keys — TERMS.md rule:
// code stays ASCII, Cyrillic lives only in translated values.
const SECTION_TRANSLATION_KEYS: Record<MedCardSectionKey, string> = {
  жалобы: 'complaints',
  анамнез: 'anamnesis',
  объективно: 'objective',
  диагноз: 'diagnosis',
  назначения: 'prescriptions',
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
          <Typography variant="body">{medCard[key].текст}</Typography>
          {key === 'диагноз' && (
            <DataRow label={t('medcard.icd10')} value={medCard.диагноз.мкб10} />
          )}
        </SectionCard>
      ))}
    </Fragment>
  );
}
