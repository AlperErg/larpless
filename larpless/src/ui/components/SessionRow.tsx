import { StyleSheet, View } from 'react-native';
import type { SessionSummary, StudyModule } from '../../contracts/domain';
import { relookBreakdown } from '../lib/derive';
import { formatDay, formatDuration, formatTime } from '../lib/format';
import { space } from '../theme';
import { BreakdownBar } from './BreakdownBar';
import { Button } from './Button';
import { Text } from './Text';
import type { ToggleItem } from './ToggleList';

/** Header line for a session in a ToggleList: date · duration · focus % · mini breakdown bar. */
export function SessionRowHeader({ s, modules }: { s: SessionSummary; modules: StudyModule[] }) {
  return (
    <View style={styles.row}>
      <Text numberOfLines={1} style={styles.date}>
        {`${formatDay(s.startedAt)} · ${formatTime(s.startedAt)}`}
      </Text>
      <Text weight="medium" style={styles.dur}>
        {formatDuration(s.totalS)}
      </Text>
      <Text muted style={styles.pct}>{`${s.focusPct}%`}</Text>
      <BreakdownBar entries={relookBreakdown(s.breakdown, modules)} height={6} style={styles.bar} />
    </View>
  );
}

export function SessionRowBody({
  s,
  modules,
  onOpen,
  onDelete,
}: {
  s: SessionSummary;
  modules: StudyModule[];
  onOpen?: () => void;
  onDelete?: () => void;
}) {
  return (
    <View>
      <BreakdownBar entries={relookBreakdown(s.breakdown, modules)} legend legendTime hideBar />
      <View style={styles.bodyRow}>
        <Text variant="small">
          {`Focus ${formatDuration(s.focusS)} of ${formatDuration(s.totalS)} · ${s.pomodoros} pomodoro${s.pomodoros === 1 ? '' : 's'}`}
        </Text>
        {onOpen ? <Button title="Open summary" variant="ghost" onPress={onOpen} style={styles.open} /> : null}
        {onDelete ? (
          <Button testID={`delete-session-${s.id}`} title="Delete" variant="danger" onPress={onDelete} style={styles.open} />
        ) : null}
      </View>
    </View>
  );
}

export function sessionToggleItem(
  s: SessionSummary,
  modules: StudyModule[],
  onOpen?: (id: string) => void,
  onDelete?: (id: string) => void,
): ToggleItem {
  return {
    key: s.id,
    header: <SessionRowHeader s={s} modules={modules} />,
    body: () => (
      <SessionRowBody
        s={s}
        modules={modules}
        onOpen={onOpen ? () => onOpen(s.id) : undefined}
        onDelete={onDelete ? () => onDelete(s.id) : undefined}
      />
    ),
  };
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  date: { width: 150 },
  dur: { width: 64 },
  pct: { width: 44 },
  bar: { flex: 1, marginLeft: space.sm, maxWidth: 260 },
  bodyRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
  open: { marginLeft: space.sm },
});
