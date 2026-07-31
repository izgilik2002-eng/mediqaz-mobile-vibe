import { useCallback, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioRecorder,
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
      // A leftover session — a double press, or a previous attempt that
      // errored after preparing — leaves the native recorder "prepared";
      // it refuses to prepare again without an explicit stop first.
      await stopIfPrepared(recorder);
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

      // Bytes, not a Blob: reading a `file://` URI yields a Blob with an empty
      // `type` (there is no HTTP response to take a Content-Type from), and
      // expo/fetch overwrites the upload's Content-Type header with exactly
      // that — which the server then rejects as an invalid recording type.
      const audioResponse = await fetch(uri);
      const audioBytes = await audioResponse.arrayBuffer();

      const { medCard } = await api.uploadRecording(appointmentId, {
        data: audioBytes,
        contentType: CONSULTATION_AUDIO_CONTENT_TYPE,
      });
      dispatch({ type: 'upload-succeeded', medCard, appointmentId });
    } catch (error) {
      dispatch({ type: 'failed', message: apiErrorMessage(error, t) });
    }
  }, [api, recorder, t]);

  const reset = useCallback(() => {
    appointmentIdRef.current = null;
    // Fire-and-forget: an error can be reached while the recorder is still
    // prepared (e.g. stopAndSend's own recorder.stop() failing), so the next
    // "Начать приём" must not inherit that stale session.
    void stopIfPrepared(recorder);
    dispatch({ type: 'reset' });
  }, [recorder]);

  return {
    state,
    elapsedMs: recorderState.durationMillis,
    start,
    stopAndSend,
    reset,
  };
}

/**
 * expo-audio refuses `prepareToRecordAsync()` on a recorder that is already
 * prepared or recording ("AudioRecorder has already been prepared. Stop or
 * release the current session before preparing again."). `release()` is not
 * the right tool here — it permanently detaches the JS handle from its
 * native object, and this recorder is reused for the lifetime of the screen
 * (see useAudioRecorder's memoization). `stop()` is the reusable reset.
 */
async function stopIfPrepared(recorder: AudioRecorder) {
  const status = recorder.getStatus();
  if (!status.canRecord && !status.isRecording) return;

  try {
    await recorder.stop();
  } catch {
    // Best-effort: prepareToRecordAsync will surface a clearer error next if
    // the native session still refuses to reset.
  }
}
