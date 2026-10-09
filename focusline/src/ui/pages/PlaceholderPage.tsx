import { Callout, Text } from '../components';
import { Page } from '../layout/Page';

/** Routes that exist in the nav contract but aren't built yet (Phase 2: feed, profile, login). */
export function PlaceholderPage({ icon, title, note }: { icon: string; title: string; note: string }) {
  return (
    <Page testID={`page-placeholder-${title.toLowerCase()}`} header={{ icon, title }}>
      <Callout emoji="🚧">
        <Text>{note}</Text>
      </Callout>
    </Page>
  );
}
