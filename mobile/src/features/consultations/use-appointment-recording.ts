import { useCallback, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

import { apiErrorMessage } from '@/platform/api';
import type { ConsultationsApi } from './api';
import {
  CONSULTATION_AUDIO_CONTENT_TYPE,
  CONSULTATION_RECORDING_OPTIONS,
  normalizedPatientName,
  recordingSessionReducer,
  type RecordingSessionState,
} from './recording-session';

export function useAppointmentRecording(api: ConsultationsApi) {
  const { t } = useTranslation();
  const recorder = useAudioRecorder(CONSULTATION_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [state, dispatch] = useReducer(recordingSessionReducer, { phase: 'idle' } as RecordingSessionState);
  const appointmentIdRef = useRef<string | null>(null);

  const start = useCallback(
    async (patientName: string) => {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        dispatch({ type: 'failed', message: t('appointment.microphoneDenied') });
        return;
      }

      try {
        const { appointment } = await api.startAppointment({
          patientName: normalizedPatientName(patientName),
        });
        appointmentIdRef.current = appointment.id;
      } catch (error) {
        dispatch({ type: 'failed', message: apiErrorMessage(error, t) });
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        // Keeps the mic session alive while the phone locks or the doctor
        // switches apps on iOS; a persistent Android foreground service is a
        // separate follow-up task.
        allowsBackgroundRecording: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      dispatch({ type: 'start', startedAt: Date.now() });
    },
    [api, recorder, t],
  );

  const stopAndSend = useCallback(async () => {
    dispatch({ type: 'stop' });

    try {
      await recorder.stop();
      const uri = recorder.uri;
      const appointmentId = appointmentIdRef.current;
      if (!uri || !appointmentId) {
        throw new Error('Recording finished without a file or appointment');
      }

      const audioResponse = await fetch(uri);
      const audioBlob = await audioResponse.blob();

      await api.uploadRecording(appointmentId, {
        data: audioBlob,
        contentType: CONSULTATION_AUDIO_CONTENT_TYPE,
      });
      dispatch({ type: 'upload-succeeded' });
    } catch (error) {
      dispatch({ type: 'failed', message: apiErrorMessage(error, t) });
    }
  }, [api, recorder, t]);

  const reset = useCallback(() => {
    appointmentIdRef.current = null;
    dispatch({ type: 'reset' });
  }, []);

  return {
    state,
    elapsedMs: recorderState.durationMillis,
    start,
    stopAndSend,
    reset,
  };
}
