import type { UserDto } from '@mediqaz/contracts';

import { useAuth } from './provider';

/**
 * Who may see the doctor-facing app. Kept as one decision so a new protected
 * screen cannot quietly skip the approval check the way each screen used to
 * repeat its own guard.
 */
export type DoctorAccess =
  | { state: 'loading' }
  | { state: 'signed-out' }
  | { state: 'pending-approval'; user: UserDto }
  | { state: 'allowed'; user: UserDto };

export function doctorAccessState(input: {
  isBootstrapping: boolean;
  user: UserDto | null;
}): DoctorAccess {
  // Session restore has to settle first, otherwise a returning doctor is
  // bounced to sign-in on every cold start.
  if (input.isBootstrapping) return { state: 'loading' };
  if (!input.user) return { state: 'signed-out' };
  if (!input.user.isApproved) return { state: 'pending-approval', user: input.user };
  return { state: 'allowed', user: input.user };
}

export function useDoctorAccess(): DoctorAccess {
  const auth = useAuth();
  return doctorAccessState({ isBootstrapping: auth.isBootstrapping, user: auth.user });
}
