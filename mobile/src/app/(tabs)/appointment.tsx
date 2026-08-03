import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { DEFAULT_TRANSCRIPTION_LANGUAGE } from '@mediqaz/contracts';

import { ScreenShell, SectionCard } from '@/components/dashboard';
import { useAuth } from '@/features/auth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import {
  formatElapsedTime,
  MedCardView,
  useAppointmentRecording,
  useConsultationsApi,
  useMisDelivery,
  type MisDeliveryState,
} from '@/features/consultations';

export default function AppointmentScreen() {
  const { t } = useTranslation();
  const api = useConsultationsApi();
  const auth = useAuth();
  const { state, elapsedMs, start, stopAndSend, reset } = useAppointmentRecording(
    api,
    auth.user?.transcriptionLanguage ?? DEFAULT_TRANSCRIPTION_LANGUAGE,
  );
  const { state: delivery, send: sendToMis, reset: resetDelivery } = useMisDelivery(api);
  const [patientName, setPatientName] = useState('');

  // Read through a ref, not `state` directly, so this callback's identity stays
  // stable: it must only react to a genuine focus event (returning to the tab),
  // not to state.phase turning 'error' while the screen is already focused —
  // that would wipe the error before the doctor ever sees it.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useFocusEffect(
    useCallback(() => {
      if (stateRef.current.phase === 'error') {
        reset();
      }
    }, [reset]),
  );

  const isIdleOrError = state.phase === 'idle' || state.phase === 'error';
  const isRecording = state.phase === 'recording';
  const isUploading = state.phase === 'uploading';
  const isDone = state.phase === 'done';

  const startNewAppointment = useCallback(() => {
    setPatientName('');
    resetDelivery();
    reset();
  }, [reset, resetDelivery]);

  return (
    <ScreenShell
      eyebrow={t('appointment.eyebrow')}
      testID={TEST_IDS.appointment.screen}
      title={t('appointment.title')}>
      <SectionCard description={t('appointment.description')} title={t('appointment.title')}>
        {isIdleOrError && (
          <Field>
            <FieldLabel>{t('appointment.patientNameLabel')}</FieldLabel>
            <Input
              accessibilityLabel={t('appointment.patientNameLabel')}
              placeholder={t('appointment.patientNamePlaceholder')}
              testID={TEST_IDS.appointment.patientNameInput}
              value={patientName}
              onChangeText={setPatientName}
            />
          </Field>
        )}

        {(isRecording || isUploading) && (
          <Typography
            testID={TEST_IDS.appointment.timer}
            variant="h1"
            align="center">
            {formatElapsedTime(elapsedMs)}
          </Typography>
        )}

        {!isIdleOrError && (
          <Typography
            accessibilityLiveRegion="polite"
            testID={TEST_IDS.appointment.status}
            align="center"
            muted
            variant="bodySm">
            {isRecording && t('appointment.statusRecording')}
            {isUploading && t('appointment.statusUploading')}
            {isDone && t('appointment.statusDone')}
          </Typography>
        )}

        {state.phase === 'error' && (
          <Alert accessibilityLiveRegion="polite" testID={TEST_IDS.appointment.error} variant="destructive">
            <AlertTitle>{t('appointment.errorTitle')}</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        {isIdleOrError && (
          <Button
            accessibilityLabel={t('appointment.startButton')}
            testID={TEST_IDS.appointment.startButton}
            onPress={() => void start(patientName)}>
            {t('appointment.startButton')}
          </Button>
        )}

        {isRecording && (
          <Button
            accessibilityLabel={t('appointment.stopButton')}
            testID={TEST_IDS.appointment.stopButton}
            onPress={() => void stopAndSend()}>
            {t('appointment.stopButton')}
          </Button>
        )}

        {isUploading && (
          <Button
            accessibilityLabel={t('appointment.statusUploading')}
            disabled
            loading
            testID={TEST_IDS.appointment.stopButton}>
            {t('appointment.statusUploading')}
          </Button>
        )}
      </SectionCard>

      {state.phase === 'done' && <MedCardView medCard={state.medCard} />}

      {delivery.phase === 'error' && (
        <Alert
          accessibilityLiveRegion="polite"
          testID={TEST_IDS.appointment.medCard.deliveryError}
          variant="destructive">
          <AlertTitle>{t('appointment.misFailedTitle')}</AlertTitle>
          <AlertDescription>{delivery.message}</AlertDescription>
        </Alert>
      )}

      {delivery.phase === 'sent' && (
        <Typography
          accessibilityLiveRegion="polite"
          testID={TEST_IDS.appointment.medCard.deliveryStatus}
          align="center"
          muted
          variant="bodySm">
          {t('appointment.misSent')}
        </Typography>
      )}

      {state.phase === 'done' && (
        <Button
          accessibilityLabel={misButtonLabel(delivery.phase, t)}
          disabled={delivery.phase === 'sending'}
          loading={delivery.phase === 'sending'}
          testID={TEST_IDS.appointment.medCard.sendToMisButton}
          variant="secondary"
          onPress={() => void sendToMis(state.appointmentId)}>
          {misButtonLabel(delivery.phase, t)}
        </Button>
      )}

      {isDone && (
        <Button
          accessibilityLabel={t('appointment.newButton')}
          testID={TEST_IDS.appointment.newButton}
          onPress={startNewAppointment}>
          {t('appointment.newButton')}
        </Button>
      )}
    </ScreenShell>
  );
}

/**
 * After a success or a failure the button stays live and renames itself: the
 * doctor may have missed the banner in the browser, or the extension may not
 * have been open, and re-sending is the fix for both.
 */
function misButtonLabel(phase: MisDeliveryState['phase'], t: TFunction) {
  if (phase === 'sending') return t('appointment.misSending');
  if (phase === 'idle') return t('appointment.sendToMis');
  return t('appointment.misSendAgain');
}
