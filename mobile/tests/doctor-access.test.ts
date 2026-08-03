import { expect, test } from 'bun:test';
import type { UserDto } from '@mediqaz/contracts';

import { doctorAccessState } from '../src/features/auth/access';

const approvedDoctor: UserDto = {
  id: 'doctor-1',
  email: 'doctor@example.com',
  displayName: 'Доктор',
  role: 'user',
  isApproved: true,
  specialty: 'therapist',
  transcriptionLanguage: 'ru',
  createdAt: '2026-07-27T00:00:00.000Z',
};

const pendingDoctor: UserDto = { ...approvedDoctor, isApproved: false, specialty: null };

test('waits for session restore before deciding, so a cold start does not bounce to sign-in', () => {
  expect(doctorAccessState({ isBootstrapping: true, user: null })).toEqual({ state: 'loading' });
  expect(doctorAccessState({ isBootstrapping: true, user: approvedDoctor })).toEqual({
    state: 'loading',
  });
});

test('sends a signed-out visitor to sign-in', () => {
  expect(doctorAccessState({ isBootstrapping: false, user: null })).toEqual({
    state: 'signed-out',
  });
});

test('holds an unapproved doctor at the waiting screen', () => {
  expect(doctorAccessState({ isBootstrapping: false, user: pendingDoctor })).toEqual({
    state: 'pending-approval',
    user: pendingDoctor,
  });
});

test('lets an approved doctor in', () => {
  expect(doctorAccessState({ isBootstrapping: false, user: approvedDoctor })).toEqual({
    state: 'allowed',
    user: approvedDoctor,
  });
});

test('approval is what opens the app, not the administrator role', () => {
  const unapprovedAdmin: UserDto = { ...approvedDoctor, role: 'admin', isApproved: false };
  const approvedWithoutSpecialty: UserDto = { ...approvedDoctor, specialty: null };

  // An administrator is not automatically cleared to record consultations.
  expect(doctorAccessState({ isBootstrapping: false, user: unapprovedAdmin }).state).toBe(
    'pending-approval',
  );
  // A missing specialty is handled inside the app, not by locking the doctor out.
  expect(doctorAccessState({ isBootstrapping: false, user: approvedWithoutSpecialty }).state).toBe(
    'allowed',
  );
});
