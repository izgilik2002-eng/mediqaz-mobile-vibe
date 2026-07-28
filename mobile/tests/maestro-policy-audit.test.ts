import { expect, test } from 'bun:test';

import {
  authScreenUsesKeyboardAwareShell,
} from '../scripts/e2e/maestro-policy-audit.mjs';

const paywallAccountActionsSource = `
  function PaywallAccountActions({ onLogout }) {
    return (
      <Button
        testID={TEST_IDS.auth.logoutButton}
        onPress={onLogout}>
        Logout
      </Button>
    )
  }
`;

test('Maestro keyboard audit accepts only an enabled auth-form shell', () => {
  expect(
    authScreenUsesKeyboardAwareShell(`
      function AuthScreen() {
        return <ScreenShell keyboardAware={false}>Form</ScreenShell>
      }
    `),
  ).toBe(false);

  expect(
    authScreenUsesKeyboardAwareShell(`
      function AuthScreen() {
        return <ScreenShell keyboardAware>Form</ScreenShell>
      }
    `),
  ).toBe(true);
});

