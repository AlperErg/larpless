/** Open-source notices: Settings → About → Acknowledgements, and LarpLess → Acknowledgements on macOS. */
import { StyleSheet, View } from 'react-native';
import { noticeGroups } from '../../legal/acknowledgements';
import type { Notice } from '../../legal/acknowledgements';
import { Tag, Text, ToggleList } from '../components';
import { Page } from '../layout/Page';
import { IS_WINDOWS } from '../platform';
import { colors, fonts, radius, space, themed } from '../theme';

const GROUPS = noticeGroups(IS_WINDOWS ? 'windows' : 'macos');

export function AcknowledgementsPage() {
  return (
    <Page testID="page-acknowledgements" header={{ icon: 'scale', title: 'Acknowledgements' }}>
      <Text muted>
        LarpLess is built on open-source software, fonts and models. These are their copyright notices and licences.
      </Text>
      {GROUPS.map((g) => (
        <View key={g.title} testID={`ack-group-${g.title}`}>
          <Text variant="h3" style={styles.group}>
            {g.title}
          </Text>
          <ToggleList
            items={g.notices.map((n) => ({
              key: `${n.name}@${n.version ?? ''}`,
              header: <NoticeHeader notice={n} />,
              body: (
                <Text selectable style={styles.license}>
                  {n.text}
                </Text>
              ),
            }))}
          />
        </View>
      ))}
    </Page>
  );
}

function NoticeHeader({ notice }: { notice: Notice }) {
  return (
    <>
      <Text numberOfLines={1} style={styles.name}>
        {notice.name}
      </Text>
      {/* Also the spacer that pushes the licence to the right. */}
      <Text variant="small" numberOfLines={1} style={styles.version}>
        {notice.version ?? ''}
      </Text>
      <Tag label={notice.license} />
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  group: { marginTop: space.xxl, marginBottom: space.xs },
  name: { flexShrink: 1 },
  version: { flex: 1, marginLeft: space.sm, marginRight: space.sm },
  license: {
    fontFamily: fonts.mono,
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    padding: space.md,
    borderRadius: radius,
    backgroundColor: colors.raised,
  },
}));
