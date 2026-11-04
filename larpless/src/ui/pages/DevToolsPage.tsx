/**
 * Dev tools (only reachable when config.SHOW_DEV_TOOLS): loads fixture snapshots into the stores, so the
 * session, break and summary screens can be checked without a real session.
 */
import { StyleSheet, View } from 'react-native';
import { applyFixture, applyFullFixture } from '../../fixtures/apply';
import type { FixtureName } from '../../fixtures/apply';
import { useAppStore } from '../../store/appStore';
import { Button, Text } from '../components';
import { Page } from '../layout/Page';
import { space, themed } from '../theme';

const FIXTURES: FixtureName[] = ['idle', 'running', 'distracted', 'break', 'summary'];

export function DevToolsPage() {
  return (
    <Page testID="page-dev" header={{ icon: 'wrench', title: 'Dev tools' }}>
      <Text variant="h3" style={styles.h}>
        Fixtures
      </Text>
      <Text variant="small" style={styles.note}>
        Loads a store snapshot plus the fixture modules and history. Actions still run against the real stores.
      </Text>
      <View style={styles.row}>
        {FIXTURES.map((f) => (
          <Button key={f} testID={`fixture-${f}`} title={f} variant="secondary" onPress={() => applyFullFixture(f)} style={styles.btn} />
        ))}
        <Button
          title="Empty stores"
          variant="ghost"
          onPress={() => {
            applyFixture('idle');
            useAppStore.setState({ modules: [], sessions: [] });
          }}
          style={styles.btn}
        />
      </View>
    </Page>
  );
}

const styles = themed(() => StyleSheet.create({
  h: { marginBottom: space.sm },
  note: { marginBottom: space.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  btn: { marginRight: space.sm, marginBottom: space.sm },
}));
