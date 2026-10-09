/**
 * Phase 0 dev shell: Home placeholder | Harness A | Harness B.
 * WS-D replaces this file (and keeps the harnesses reachable from Dev tools).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeEventEmitter, NativeModules, Pressable, StyleSheet, Text, View } from 'react-native';
import { config } from './config';
import HarnessA from './dev/HarnessA';
import HarnessB from './dev/HarnessB';

type TabId = 'home' | 'harnessA' | 'harnessB';

const TABS: { id: TabId; label: string }[] = [
  { id: 'home', label: 'Home (placeholder)' },
  { id: 'harnessA', label: 'Harness A' },
  { id: 'harnessB', label: 'Harness B' },
];

interface PingOutcome {
  result: string;
  eventReceived: boolean;
  eventBody: unknown;
}

/** Calls FLPing.ping() and waits up to `timeoutMs` for both the promise and the FLPingEvent. */
function pingNative(timeoutMs = 2000): Promise<PingOutcome> {
  const M = NativeModules.FLPing;
  if (!M || typeof M.ping !== 'function') {
    return Promise.resolve({ result: 'FLPing missing', eventReceived: false, eventBody: null });
  }
  return new Promise((resolve) => {
    const outcome: PingOutcome = { result: 'pending', eventReceived: false, eventBody: null };
    let resolved = false;
    let gotResult = false;
    const emitter = new NativeEventEmitter(M);
    const sub = emitter.addListener('FLPingEvent', (body: unknown) => {
      outcome.eventReceived = true;
      outcome.eventBody = body;
      maybeFinish();
    });
    const timer = setTimeout(finish, timeoutMs);

    function finish() {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      sub.remove();
      resolve(outcome);
    }
    function maybeFinish() {
      if (gotResult && outcome.eventReceived) finish();
    }

    Promise.resolve()
      .then(() => M.ping())
      .then((r: unknown) => {
        outcome.result = String(r);
      })
      .catch((e: unknown) => {
        outcome.result = `error: ${e instanceof Error ? e.message : String(e)}`;
      })
      .finally(() => {
        gotResult = true;
        maybeFinish();
      });
  });
}

function HomePlaceholder() {
  const [ping, setPing] = useState<PingOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const runPing = useCallback(async () => {
    setBusy(true);
    const outcome = await pingNative(2000);
    if (mounted.current) {
      setPing(outcome);
      setBusy(false);
    }
    return outcome;
  }, []);

  useEffect(() => {
    mounted.current = true;
    runPing().then((o) => {
      console.log('[phase0] ping result', o.result, 'event', o.eventReceived);
    });
    return () => {
      mounted.current = false;
    };
  }, [runPing]);

  return (
    <View style={styles.home}>
      <Text style={styles.title}>Focusline — Phase 0</Text>
      <Text style={styles.line}>USE_MOCK_NATIVE: {String(config.USE_MOCK_NATIVE)}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={runPing}
        disabled={busy}
        style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonPressed]}>
        <Text style={styles.buttonText}>{busy ? 'Pinging…' : 'Ping native'}</Text>
      </Pressable>
      <Text style={styles.line}>ping(): {ping ? ping.result : '—'}</Text>
      <Text style={styles.line}>
        FLPingEvent: {ping ? (ping.eventReceived ? `received ${JSON.stringify(ping.eventBody)}` : 'not received') : '—'}
      </Text>
    </View>
  );
}

function App() {
  const [tab, setTab] = useState<TabId>('home');

  return (
    <View style={styles.root}>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            accessibilityRole="button"
            onPress={() => setTab(t.id)}
            style={[styles.tab, tab === t.id && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {/* All panes stay mounted so the harnesses can auto-run their checks on mount. */}
      <View style={[styles.pane, tab !== 'home' && styles.hidden]}>
        <HomePlaceholder />
      </View>
      <View style={[styles.pane, tab !== 'harnessA' && styles.hidden]}>
        <HarnessA />
      </View>
      <View style={[styles.pane, tab !== 'harnessB' && styles.hidden]}>
        <HarnessB />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'white' },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.15)',
  },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, marginRight: 4 },
  tabActive: { backgroundColor: 'rgba(0,0,0,0.07)' },
  tabText: { fontSize: 13, color: 'dimgray' },
  tabTextActive: { color: 'black', fontWeight: '600' },
  pane: { flex: 1 },
  hidden: { display: 'none' },
  home: { flex: 1, padding: 24 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 12, color: 'black' },
  line: { fontSize: 14, marginVertical: 4, color: 'black' },
  button: {
    alignSelf: 'flex-start',
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: 'royalblue',
  },
  buttonPressed: { opacity: 0.6 },
  buttonText: { color: 'white', fontWeight: '600' },
});

export default App;
