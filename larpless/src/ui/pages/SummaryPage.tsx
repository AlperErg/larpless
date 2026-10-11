/**
 * Summary (D7): stats, breakdown, and a relabel-able timeline of chunks.
 * Shows `lastSummary` by default, or `params.sessionId` when opened from Home/History.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Chunk, SessionSummary, StudyModule } from '../../contracts/domain';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { useSessionStore } from '../../store/sessionStore';
import { BreakdownBar, Button, Callout, PrivacyBadge, Tag, Text, ToggleList, ToggleRow } from '../components';
import type { ToggleItem } from '../components';
import { SharePanel } from '../components/SharePanel';
import { Page } from '../layout/Page';
import { breakdownFromChunks, focusPctFromChunks, lookChunk, relookBreakdown } from '../lib/derive';
import { formatDuration, formatLongDate, formatTime, formatTimeS } from '../lib/format';
import { colors, fonts, space, themed } from '../theme';
import { useAllModules } from '../lib/useAllModules';

type Patch = Pick<Chunk, 'kind' | 'moduleId' | 'reason'>;

export function SummaryPage() {
  const params = useNavStore((s) => s.params);
  const go = useNavStore((s) => s.go);
  const lastSummary = useSessionStore((s) => s.lastSummary);
  const liveSession = useSessionStore((s) => s.session);
  const storeChunks = useSessionStore((s) => s.chunks);
  const privacy = useSessionStore((s) => s.privacy);
  const relabelChunk = useSessionStore((s) => s.relabelChunk);
  const sessions = useAppStore((s) => s.sessions);
  const modules = useAllModules();
  const getChunks = useAppStore((s) => s.getChunks);

  const wantedId = params.sessionId ?? lastSummary?.id ?? null;
  const summary: SessionSummary | null =
    (wantedId && lastSummary?.id === wantedId ? lastSummary : sessions.find((s) => s.id === wantedId)) ?? lastSummary ?? null;
  const isCurrent = !!summary && liveSession?.id === summary.id;

  // Chunks: the store's for the session that just ended, otherwise loaded from the db.
  const [loaded, setLoaded] = useState<Chunk[] | null>(null);
  useEffect(() => {
    setLoaded(null);
    if (!summary || isCurrent) return undefined;
    let alive = true;
    getChunks(summary.id)
      .then((c) => {
        if (alive) setLoaded(c);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [summary?.id, isCurrent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Optimistic relabels so the bar and tags react instantly; the store/db is the source of truth.
  const [overrides, setOverrides] = useState<Record<string, Patch>>({});
  useEffect(() => setOverrides({}), [summary?.id]);
  const chunks = useMemo(
    () =>
      (isCurrent ? storeChunks : loaded ?? []).map((c) =>
        overrides[c.id] ? { ...c, ...overrides[c.id], source: 'user' as const } : c,
      ),
    [isCurrent, storeChunks, loaded, overrides],
  );

  if (!summary) {
    return (
      <Page testID="page-summary" header={{ icon: '🏁', title: 'Summary' }}>
        <Callout testID="summary-empty" emoji="🌱">
          <Text>No finished session yet. Start one and its summary lands here.</Text>
        </Callout>
        <Button title="Go home" variant="secondary" onPress={() => go('home')} style={styles.block} />
      </Page>
    );
  }

  const breakdown = chunks.length ? breakdownFromChunks(chunks, modules) : relookBreakdown(summary.breakdown, modules);
  const focusPct = chunks.length ? focusPctFromChunks(chunks) : summary.focusPct;
  const top = breakdown.find((e) => e.key !== 'distracted');

  const relabel = (c: Chunk, patch: Patch) => {
    setOverrides((o) => ({ ...o, [c.id]: patch }));
    relabelChunk(c.id, patch).catch((e: unknown) => console.warn('[ui] relabel failed:', e instanceof Error ? e.message : String(e)));
  };

  return (
    <Page
      testID="page-summary"
      header={{
        icon: '🏁',
        title: 'Session complete',
        cover: top?.color ?? null,
        subtitle: (
          <Text variant="small">{`${formatLongDate(summary.startedAt)} · ${formatTime(summary.startedAt)}–${formatTime(summary.endedAt)}`}</Text>
        ),
      }}>
      <View testID="summary-stats" style={styles.stats}>
        <Stat value={formatDuration(summary.totalS)} label="Focus time" />
        <Stat value={`${focusPct}%`} label="Focused" />
        <Stat value={String(summary.pomodoros)} label={summary.pomodoros === 1 ? 'Pomodoro' : 'Pomodoros'} />
      </View>

      <View style={styles.block}>
        <BreakdownBar testID="summary-breakdown" entries={breakdown} legend legendTime />
      </View>

      <SharePanel summary={summary} breakdown={breakdown} focusPct={focusPct} style={styles.section} />

      {isCurrent ? (
        <PrivacyBadge
          framesAnalysed={privacy.framesAnalysed}
          checksWithoutScreenshot={privacy.checksWithoutScreenshot}
          framesStored={privacy.framesStored}
          style={styles.block}
        />
      ) : null}

      <View style={styles.section}>
        {chunks.length ? (
          <Timeline chunks={chunks} modules={modules} onRelabel={relabel} />
        ) : (
          <Text variant="small">{loaded === null && !isCurrent ? 'Loading the timeline…' : 'No checks recorded for this session.'}</Text>
        )}
      </View>

      <View style={[styles.section, styles.row]}>
        <Button testID="summary-done" title="Done" variant="primary" onPress={() => go('home')} />
        <Button title="History" variant="ghost" onPress={() => go('history')} style={styles.gapLeft} />
      </View>
    </Page>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text serif style={styles.statValue}>
        {value}
      </Text>
      <Text variant="small">{label}</Text>
    </View>
  );
}

function Timeline({ chunks, modules, onRelabel }: { chunks: Chunk[]; modules: StudyModule[]; onRelabel: (c: Chunk, p: Patch) => void }) {
  const [open, setOpen] = useState(true);
  const outer: ToggleItem = {
    key: 'timeline',
    header: <Text weight="semibold">{`Timeline (${chunks.length} checks)`}</Text>,
  };
  return (
    <View testID="summary-timeline">
      <ToggleRow item={outer} open={open} onToggle={() => setOpen((o) => !o)} />
      {open ? (
        <ToggleList
          style={styles.timeline}
          items={chunks.map((c) => ({
            key: c.id,
            header: <ChunkHeader c={c} modules={modules} />,
            body: () => <RelabelChips c={c} modules={modules} onRelabel={onRelabel} />,
          }))}
        />
      ) : null}
    </View>
  );
}

const SOURCE_LABEL: Record<Chunk['source'], string> = {
  vlm: 'AI',
  rule: 'rule',
  cache: 'cache',
  title: 'title',
  webcam: 'camera',
  none: '',
  user: 'edited',
};

function ChunkHeader({ c, modules }: { c: Chunk; modules: StudyModule[] }) {
  const look = lookChunk(c, modules);
  return (
    <View style={styles.chunkRow}>
      <Text variant="small" style={styles.chunkTime}>
        {formatTimeS(c.startedAt)}
      </Text>
      <Tag label={look.label} color={look.color} style={styles.chunkTag} />
      <Text numberOfLines={1} style={styles.flex}>
        {c.kind === 'distracted' && c.reason === 'phone' ? 'Phone' : c.activity}
      </Text>
      <Text variant="small" numberOfLines={1} style={styles.chunkApp}>
        {[c.appName, SOURCE_LABEL[c.source]].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

function RelabelChips({ c, modules, onRelabel }: { c: Chunk; modules: StudyModule[]; onRelabel: (c: Chunk, p: Patch) => void }) {
  return (
    <View testID={`relabel-${c.id}`} style={styles.chips}>
      <Text variant="small" style={styles.chipsLabel}>
        Relabel:
      </Text>
      {modules.map((m) => (
        <Tag
          key={m.id}
          testID={`relabel-${c.id}-${m.id}`}
          label={m.name}
          color={m.color}
          selected={c.kind === 'subject' && c.moduleId === m.id}
          onPress={() => onRelabel(c, { kind: 'subject', moduleId: m.id, reason: null })}
          style={styles.chip}
        />
      ))}
      <Tag
        testID={`relabel-${c.id}-distracted`}
        label="Distracted"
        color="red"
        selected={c.kind === 'distracted'}
        onPress={() => onRelabel(c, { kind: 'distracted', moduleId: null, reason: c.reason ?? 'screen' })}
        style={styles.chip}
      />
      <Tag
        testID={`relabel-${c.id}-away`}
        label="Away"
        color="gray"
        selected={c.kind === 'away'}
        onPress={() => onRelabel(c, { kind: 'away', moduleId: null, reason: null })}
        style={styles.chip}
      />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  gapLeft: { marginLeft: space.md },
  block: { marginTop: space.lg },
  section: { marginTop: space.xxl },
  stats: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { marginRight: space.xxxl, marginBottom: space.sm },
  statValue: { fontFamily: fonts.serif, fontSize: 48, lineHeight: 58, color: colors.text },
  timeline: { marginTop: space.xs },
  chunkRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  chunkTime: { width: 64 },
  chunkTag: { marginRight: space.sm, alignSelf: 'center' },
  chunkApp: { marginLeft: space.sm, maxWidth: 160, color: colors.faint },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  chipsLabel: { marginRight: space.sm },
  chip: { marginRight: space.xs + 2, marginVertical: 2 },
}));
