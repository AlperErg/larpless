import { Button } from '../components';
import { Page } from '../layout/Page';
import { startSession } from '../lib/actions';

// Sprint 2 (D6) replaces this stub.
export function HomePage() {
  return (
    <Page testID="page-home" header={{ icon: '🎯', title: 'Focusline' }}>
      <Button testID="start-session" title="Start session" variant="primary" size="lg" onPress={() => startSession()} />
    </Page>
  );
}
