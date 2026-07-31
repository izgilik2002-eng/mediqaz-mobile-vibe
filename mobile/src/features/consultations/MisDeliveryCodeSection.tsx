import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert as RNAlert } from 'react-native';

import { SectionCard } from '@/components/dashboard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import { apiErrorMessage } from '@/platform/api';
import { useConsultationsApi } from './provider';

/**
 * The code is fetched rather than read from the user object on purpose: it is a
 * shared secret, and it has no business riding along in every login and session
 * refresh payload. Fetching it here also issues it — a doctor sets the
 * extension up before the first consultation, so it must exist before there is
 * anything to deliver.
 */
export function MisDeliveryCodeSection() {
  const { t } = useTranslation();
  const theme = useUiTheme();
  const api = useConsultationsApi();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .misDeliveryCode()
      .then(({ code: issued }) => {
        if (!cancelled) setCode(issued);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(apiErrorMessage(cause, t));
      });

    return () => {
      cancelled = true;
    };
  }, [api, t]);

  const regenerate = useCallback(async () => {
    setIsWorking(true);
    setError(null);
    try {
      const { code: issued } = await api.regenerateMisDeliveryCode();
      setCode(issued);
    } catch (cause) {
      setError(apiErrorMessage(cause, t));
    } finally {
      setIsWorking(false);
    }
  }, [api, t]);

  const confirmRegenerate = useCallback(() => {
    RNAlert.alert(t('profile.misCodeRegenerate'), t('profile.misCodeRegenerateConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.misCodeRegenerate'),
        style: 'destructive',
        onPress: () => void regenerate(),
      },
    ]);
  }, [regenerate, t]);

  return (
    <SectionCard
      description={t('profile.misCodeDescription')}
      testID={TEST_IDS.profile.misCodeSection}
      title={t('profile.misCodeTitle')}>
      {error ? (
        <Alert testID={TEST_IDS.profile.misCodeError} variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {code === null && error === null ? (
        <Skeleton style={{ height: theme.spacing.xl * 2 }} />
      ) : null}

      {code ? (
        <Surface bordered padded rounded="lg" tone="muted">
          <Typography selectable testID={TEST_IDS.profile.misCodeValue} variant="code">
            {code}
          </Typography>
        </Surface>
      ) : null}

      {code ? (
        <Typography muted variant="caption">
          {t('profile.misCodeHint')}
        </Typography>
      ) : null}

      <Button
        disabled={isWorking || code === null}
        loading={isWorking}
        testID={TEST_IDS.profile.misCodeRegenerateButton}
        variant="outline"
        onPress={confirmRegenerate}>
        {t('profile.misCodeRegenerate')}
      </Button>
    </SectionCard>
  );
}
