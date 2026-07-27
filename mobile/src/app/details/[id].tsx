import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

import {
  DataRow,
  ScreenShell,
  SectionCard,
} from '@/components/dashboard';
import { ScreenLoader } from '@/components/screen-states';
import { TEST_IDS } from '@/constants/testIds';
import { useDoctorAccess } from '@/features/auth';

export function generateStaticParams() {
  return [{ id: 'components' }];
}

export default function DetailsScreen() {
  const access = useDoctorAccess();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const detailsId = Array.isArray(params.id) ? params.id[0] : params.id;

  if (access.state === 'loading') {
    return <ScreenLoader />;
  }

  if (access.state === 'signed-out') {
    return <Redirect href="/" />;
  }

  if (access.state === 'pending-approval') {
    return <Redirect href={'/pending-approval' as Href} />;
  }

  return (
    <ScreenShell
      backButton="auto"
      backButtonTestID={TEST_IDS.details.backButton}
      backFallbackHref="/components"
      description="A stack route rendered with the same native header and data-card pattern."
      eyebrow="Stack screen"
      testID={TEST_IDS.details.screen}
      title="Details">
      <SectionCard
        description="Values are read directly from the Expo Router parameter."
        title="Route data">
        <DataRow
          label="Route parameter"
          value={detailsId ?? 'missing-id'}
        />
      </SectionCard>
    </ScreenShell>
  );
}
