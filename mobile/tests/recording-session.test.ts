import { expect, test } from 'bun:test';

import {
  formatElapsedTime,
  normalizedPatientName,
  recordingSessionReducer,
  type RecordingSessionState,
} from '../src/features/consultations/recording-session';

test('formats elapsed time as mm:ss, floored to the second', () => {
  expect(formatElapsedTime(0)).toBe('00:00');
  expect(formatElapsedTime(999)).toBe('00:00');
  expect(formatElapsedTime(1_000)).toBe('00:01');
  expect(formatElapsedTime(61_000)).toBe('01:01');
  expect(formatElapsedTime(3_661_000)).toBe('61:01');
});

test('clamps a negative elapsed time instead of showing a negative clock', () => {
  expect(formatElapsedTime(-5_000)).toBe('00:00');
});

test('blank patient name input is omitted, not sent as an empty string', () => {
  expect(normalizedPatientName('')).toBeUndefined();
  expect(normalizedPatientName('   ')).toBeUndefined();
  expect(normalizedPatientName('  Иванов И.И.  ')).toBe('Иванов И.И.');
});

test('starting from idle or a previous error begins a recording', () => {
  const idle: RecordingSessionState = { phase: 'idle' };
  expect(recordingSessionReducer(idle, { type: 'start', startedAt: 100 })).toEqual({
    phase: 'recording',
    startedAt: 100,
  });

  const errored: RecordingSessionState = { phase: 'error', message: 'oops' };
  expect(recordingSessionReducer(errored, { type: 'start', startedAt: 200 })).toEqual({
    phase: 'recording',
    startedAt: 200,
  });
});

test('stopping only takes effect while recording', () => {
  const recording: RecordingSessionState = { phase: 'recording', startedAt: 100 };
  expect(recordingSessionReducer(recording, { type: 'stop' })).toEqual({ phase: 'uploading' });

  const idle: RecordingSessionState = { phase: 'idle' };
  expect(recordingSessionReducer(idle, { type: 'stop' })).toEqual(idle);
});

test('a late duplicate event is ignored instead of corrupting the current phase', () => {
  const done: RecordingSessionState = { phase: 'done' };
  expect(recordingSessionReducer(done, { type: 'start', startedAt: 100 })).toEqual(done);
  expect(recordingSessionReducer(done, { type: 'upload-succeeded' })).toEqual(done);

  const uploading: RecordingSessionState = { phase: 'uploading' };
  expect(recordingSessionReducer(uploading, { type: 'start', startedAt: 100 })).toEqual(uploading);
});

test('upload success only takes effect while uploading', () => {
  const uploading: RecordingSessionState = { phase: 'uploading' };
  expect(recordingSessionReducer(uploading, { type: 'upload-succeeded' })).toEqual({
    phase: 'done',
  });
});

test('a failure surfaces from recording or uploading, carrying its message', () => {
  const recording: RecordingSessionState = { phase: 'recording', startedAt: 100 };
  expect(recordingSessionReducer(recording, { type: 'failed', message: 'Нет сети' })).toEqual({
    phase: 'error',
    message: 'Нет сети',
  });

  const uploading: RecordingSessionState = { phase: 'uploading' };
  expect(recordingSessionReducer(uploading, { type: 'failed', message: 'Сбой сервера' })).toEqual({
    phase: 'error',
    message: 'Сбой сервера',
  });
});

test('reset always returns to idle regardless of the current phase', () => {
  const done: RecordingSessionState = { phase: 'done' };
  expect(recordingSessionReducer(done, { type: 'reset' })).toEqual({ phase: 'idle' });

  const errored: RecordingSessionState = { phase: 'error', message: 'oops' };
  expect(recordingSessionReducer(errored, { type: 'reset' })).toEqual({ phase: 'idle' });
});
