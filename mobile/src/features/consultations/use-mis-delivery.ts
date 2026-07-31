import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiErrorMessage } from '@/platform/api';
import type { ConsultationsApi } from './api';

export type MisDeliveryState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent' }
  | { phase: 'error'; message: string };

/**
 * Delivery is deliberately retryable from every terminal state. The med card
 * itself is safe in the backend's own database, so a failed hand-off is never
 * data loss — but the doctor is standing at the computer waiting for it, and
 * the row on the other side expires, so "send it again" has to stay one tap
 * away. Repeats are safe: the backend replaces the pending delivery instead of
 * queueing a second banner in the extension.
 */
export function useMisDelivery(api: ConsultationsApi) {
  const { t } = useTranslation();
  const [state, setState] = useState<MisDeliveryState>({ phase: 'idle' });

  const send = useCallback(
    async (appointmentId: string) => {
      setState({ phase: 'sending' });
      try {
        await api.sendMedCardToMis(appointmentId);
        setState({ phase: 'sent' });
      } catch (error) {
        setState({ phase: 'error', message: apiErrorMessage(error, t) });
      }
    },
    [api, t],
  );

  const reset = useCallback(() => setState({ phase: 'idle' }), []);

  return { state, send, reset };
}
