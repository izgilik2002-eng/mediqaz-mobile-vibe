import { useForm } from '@tanstack/react-form';
import {
  loginRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type RegisterRequest,
} from '@mediqaz/contracts';
import { Redirect, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AuthError,
  AuthModeTabs,
  AuthPanel,
  AuthSubmitButton,
  AuthTextField,
  type AuthMode,
} from '../components/auth-components';
import { ScreenShell, ScreenState } from '@/components/dashboard';
import { ScreenLoader } from '@/components/screen-states';
import { Button } from '@/components/ui/button';
import { SocialAuthButtons } from '../components/social-auth-buttons';
import { useAuth } from '../provider';
import { TEST_IDS } from '@/constants/testIds';
import { ApiRequestError } from '@/platform/api';

const isE2eMode = process.env.EXPO_PUBLIC_E2E === '1';

export function AuthScreen() {
  const { t } = useTranslation();
  const auth = useAuth();
  const [mode, setMode] = useState<AuthMode>('register');
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === 'register';

  const form = useForm({
    defaultValues: {
      displayName: '' as string | undefined,
      email: '',
      password: '',
    },
    validators: {
      onChange: ({ value }) => {
        const result = registerRequestSchema.safeParse(value);
        return result.success ? undefined : result.error.issues;
      },
    },
    onSubmit: async ({ value }) => {
      setError(null);

      try {
        if (isRegister) {
          await auth.register(registerRequestSchema.parse(value) as RegisterRequest);
        } else {
          await auth.login(loginRequestSchema.parse(value) as LoginRequest);
        }
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setError(caughtError.message);
          return;
        }
        setError(t('auth.unexpectedError'));
      }
    },
  });

  if (auth.isBootstrapping) {
    return <ScreenLoader />;
  }

  if (auth.sessionError && !auth.user) {
    return (
      <ScreenShell
        centered
        description={t('auth.sessionRecoveryDescription')}
        eyebrow={t('auth.sessionRecoveryEyebrow')}
        title={t('auth.sessionRecoveryTitle')}>
        <ScreenState
          action={
            <Button
              accessibilityLabel={t('auth.sessionRecoveryRetry')}
              disabled={auth.isTransitioning}
              loading={auth.isTransitioning}
              onPress={() => void auth.retrySession()}>
              {t('common.tryAgain')}
            </Button>
          }
          description={auth.sessionError}
          status="error"
          title={t('auth.sessionUnreachableTitle')}
        />
      </ScreenShell>
    );
  }

  if (auth.user) {
    // An unapproved doctor goes straight to the waiting screen instead of
    // bouncing through the tabs layout to be sent back.
    return (
      <Redirect
        href={(auth.user.isApproved ? '/appointment' : '/pending-approval') as Href}
      />
    );
  }

  return (
    <ScreenShell
      centered
      description={t('auth.subtitle')}
      eyebrow={t('auth.eyebrow')}
      keyboardAware
      testID={TEST_IDS.auth.screen}
      title={t('auth.title')}>

      <AuthPanel
        description={
          isRegister
            ? t('auth.registerPanelDescription')
            : t('auth.loginPanelDescription')
        }
        title={isRegister ? t('auth.registerPanelTitle') : t('auth.loginPanelTitle')}>
        <AuthModeTabs
          disabled={auth.isTransitioning}
          mode={mode}
          loginTestID={TEST_IDS.auth.loginTab}
          registerTestID={TEST_IDS.auth.registerTab}
          onModeChange={setMode}
        />

        {isRegister && (
          <form.Field name="displayName">
            {(field) => (
              <AuthTextField
                label={t('auth.nameLabel')}
                testID={TEST_IDS.auth.nameInput}
                value={field.state.value ?? ''}
                autoComplete="name"
                onBlur={field.handleBlur}
                onChangeText={field.handleChange}
                errors={field.state.meta.errors}
              />
            )}
          </form.Field>
        )}

        <form.Field name="email">
          {(field) => (
            <AuthTextField
              label={t('auth.emailLabel')}
              testID={TEST_IDS.auth.emailInput}
              value={field.state.value}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onBlur={field.handleBlur}
              onChangeText={field.handleChange}
              errors={field.state.meta.errors}
            />
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <AuthTextField
              label={t('auth.passwordLabel')}
              testID={TEST_IDS.auth.passwordInput}
              value={field.state.value}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              secureTextEntry={!isE2eMode}
              onBlur={field.handleBlur}
              onChangeText={field.handleChange}
              errors={field.state.meta.errors}
            />
          )}
        </form.Field>

        <AuthError message={error} />

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <AuthSubmitButton
              accessibilityLabel={isRegister ? t('auth.submitRegister') : t('auth.submitLogin')}
              disabled={!canSubmit || isSubmitting || auth.isTransitioning}
              label={isSubmitting ? t('auth.submitWorking') : isRegister ? t('auth.submitRegister') : t('auth.submitLogin')}
              loading={isSubmitting}
              testID={TEST_IDS.auth.submitButton}
              onPress={() => void form.handleSubmit()}
            />
          )}
        </form.Subscribe>

        <SocialAuthButtons
          disabled={auth.isTransitioning}
          getDisplayName={() => (isRegister ? form.getFieldValue('displayName') : undefined)}
          onAuthenticate={auth.socialAuth}
          onError={setError}
        />
      </AuthPanel>
    </ScreenShell>
  );
}
