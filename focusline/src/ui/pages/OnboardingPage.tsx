import { Button } from '../components';
import { Page } from '../layout/Page';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';

// Sprint 2 (D5) replaces this stub.
export function OnboardingPage() {
  return (
    <Page testID="page-onboarding" header={{ icon: '👋', title: 'Welcome to Focusline' }}>
      <Button
        title="Get started"
        variant="primary"
        onPress={() => {
          useAppStore.getState().updateSettings({ onboarded: true }).catch(() => {});
          useNavStore.getState().go('home');
        }}
      />
    </Page>
  );
}
