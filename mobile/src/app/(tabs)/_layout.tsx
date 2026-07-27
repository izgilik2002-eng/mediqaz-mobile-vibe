import { Redirect } from 'expo-router';

import AppTabs from '@/components/app-tabs';
import { ScreenLoader } from '@/components/screen-states';
import { useDoctorAccess } from '@/features/auth';

export default function TabsLayout() {
  const access = useDoctorAccess();

  if (access.state === 'loading') {
    return <ScreenLoader />;
  }

  if (access.state === 'signed-out') {
    return <Redirect href="/" />;
  }

  if (access.state === 'pending-approval') {
    return <Redirect href="/pending-approval" />;
  }

  return <AppTabs />;
}
