import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { addDays, format } from 'date-fns';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { Callout, Heatmap, Strong, Tag, Text, ToggleList, sessionToggleItem } from '../components';
import { Page } from '../layout/Page';
import { groupByWeek, totalsBySubject } from '../lib/derive';
import { formatDuration, formatHours } from '../lib/format';
import { colors, space } from '../theme';
import { useAllModules } from '../lib/useAllModules';

export function HistoryPage() {
  const sessions = useAppStore((s) => s.sessions);
  const modules = useAllModules();
  const go = useNavStore((s) => s.go);
  const weeks = useMemo(() => groupByWeek(sessions), [sessions]);
  const totals = useMemo(() => totalsBySubject(sessions, modules), [sessions, modules]);
  const totalS = sessions.reduce((a, s) => a + s.totalS, 0);
  const open = (id: string) => go('summary', { sessionId: id });

  return (
    <Page testID="page-history" header={{ icon: '🗓', title: 'History' }}>
      {sessions.length === 0 ? (
        <Callout testID="history-empty" emoji="🌱">
          <Text>Nothing here yet. Finish a session and it shows up, grouped by week.</Text>
        </Callout>
      ) : (
        <>
          <Text muted>
            <Strong color={colors.text}>{formatDuration(totalS)}</Strong>
            {` across ${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
          </Text>

          <View style={styles.section}>
            <Text variant="h3" style={styles.h3}>
              By subject
            </Text>
            <View testID="history-totals" style={styles.totals}>
              {totals.map((t) => (
                <View key={t.key} style={styles.total}>
                  <Tag label={t.label} color={t.color} />
                  <Text weight="medium" style={styles.totalHours}>
                    {formatHours(t.seconds)}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Heatmap testID="history-heatmap" sessions={sessions} />
          </View>

          {weeks.map((w) => (
            <View key={w.key} testID={`week-${w.key}`} style={styles.section}>
              <View style={styles.weekHeader}>
                <Text variant="h3">{`Week of ${format(w.weekStart, 'd MMM')}–${format(addDays(w.weekStart, 6), 'd MMM')}`}</Text>
                <Text muted style={styles.weekTotal}>
                  {`${formatDuration(w.totalS)} · ${w.sessions.length} session${w.sessions.length === 1 ? '' : 's'}`}
                </Text>
              </View>
              <ToggleList items={w.sessions.map((s) => sessionToggleItem(s, modules, open))} />
            </View>
          ))}
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space.xxl },
  h3: { marginBottom: space.sm },
  totals: { flexDirection: 'row', flexWrap: 'wrap' },
  total: { flexDirection: 'row', alignItems: 'center', marginRight: space.xl, marginBottom: space.sm },
  totalHours: { marginLeft: space.sm },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    paddingBottom: space.xs,
    marginBottom: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  weekTotal: { marginLeft: space.md },
});
