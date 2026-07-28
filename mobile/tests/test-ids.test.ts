import { expect, test } from 'bun:test';

import { TEST_IDS } from '../src/constants/testIds';

test('navigation test IDs cover the doctor-facing tabs', () => {
  expect(TEST_IDS.tabs.appointmentTab).toBe('tabs.appointment');
  expect(TEST_IDS.tabs.profileTab).toBe('tabs.profile');
  expect(TEST_IDS.screen.backButton).toBe('screen.back-button');
  expect(TEST_IDS.auth.socialAppleButton).toBe('auth.social-apple-button');
  expect(TEST_IDS.auth.socialGoogleButton).toBe('auth.social-google-button');
});

test('every screen a doctor can reach exposes a stable selector', () => {
  expect(TEST_IDS.auth.submitButton).toBe('auth.submit-button');
  expect(TEST_IDS.approval.screen).toBe('approval.screen');
  expect(TEST_IDS.appointment.screen).toBe('appointment.screen');
  expect(TEST_IDS.profile.screen).toBe('profile.screen');
});
