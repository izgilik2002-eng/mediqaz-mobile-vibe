import { useTranslation } from 'react-i18next';

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { useAuth } from '../provider';

export function AuthSessionErrorNotice() {
  const { t } = useTranslation();
  const auth = useAuth();

  if (!auth.user || !auth.sessionError) return null;

  return (
    <Alert accessibilityLiveRegion="polite" variant="destructive">
      <AlertTitle>{t('auth.sessionNoticeTitle')}</AlertTitle>
      <AlertDescription>{auth.sessionError}</AlertDescription>
    </Alert>
  );
}
