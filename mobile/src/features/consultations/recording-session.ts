import type { RecordingOptions } from 'expo-audio';

/**
 * Mono AAC, speech-appropriate bitrate: a 20-minute visit stays well under the
 * server's per-upload limit even on a slow connection. Deliberately not the
 * expo-audio HIGH_QUALITY preset, which is stereo/128kbps and sized for music.
 */
export const CONSULTATION_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.m4a',
    // Trailing space is intentional: it's the literal iOS four-char format
    // code for AAC (expo-audio's IOSOutputFormat.MPEG4AAC), not a typo.
    outputFormat: 'aac ',
    audioQuality: 96,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

export const CONSULTATION_AUDIO_CONTENT_TYPE = 'audio/mp4';

/** Blank input is a valid choice, so it is omitted rather than sent as `''`. */
export function normalizedPatientName(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export type RecordingSessionState =
  | { phase: 'idle' }
  | { phase: 'recording'; startedAt: number }
  | { phase: 'uploading' }
  | { phase: 'done' }
  | { phase: 'error'; message: string };

export type RecordingSessionEvent =
  | { type: 'start'; startedAt: number }
  | { type: 'stop' }
  | { type: 'upload-succeeded' }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

/**
 * Pure so the screen's state transitions are testable without expo-audio or a
 * real recorder. Events from a phase that cannot produce them are ignored
 * rather than throwing, since they can arrive after an in-flight async step
 * (a stale permission response, a duplicate stop) resolves late.
 */
export function recordingSessionReducer(
  state: RecordingSessionState,
  event: RecordingSessionEvent,
): RecordingSessionState {
  switch (event.type) {
    case 'start':
      return state.phase === 'idle' || state.phase === 'error'
        ? { phase: 'recording', startedAt: event.startedAt }
        : state;
    case 'stop':
      return state.phase === 'recording' ? { phase: 'uploading' } : state;
    case 'upload-succeeded':
      return state.phase === 'uploading' ? { phase: 'done' } : state;
    case 'failed':
      return state.phase === 'recording' || state.phase === 'uploading'
        ? { phase: 'error', message: event.message }
        : state;
    case 'reset':
      return { phase: 'idle' };
    default:
      return state;
  }
}
