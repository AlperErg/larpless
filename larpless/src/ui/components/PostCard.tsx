import { formatDistanceToNow } from 'date-fns';
import { StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { TagColor } from '../../contracts/domain';
import type { FeedPost } from '../../social/api';
import { formatDuration } from '../lib/format';
import { colors, fonts, radius, space, tag } from '../theme';
import { BreakdownBar } from './BreakdownBar';
import { Tag } from './Tag';
import { Text } from './Text';

const AVATAR_COLORS: TagColor[] = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'brown', 'red'];

export function avatarColor(username: string): TagColor {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) % 1_000_003;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ username, size = 28 }: { username: string; size?: number }) {
  const tone = tag[avatarColor(username)];
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: tone.bg }]}>
      <RNText style={[styles.avatarText, { color: tone.text, fontSize: size * 0.45 }]}>{username.charAt(0).toUpperCase()}</RNText>
    </View>
  );
}

export interface PostCardProps {
  post: FeedPost;
  mine?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** One friend's session in the feed: who, when, time, focus, breakdown, caption. */
export function PostCard({ post, mine, testID, style }: PostCardProps) {
  const subjects = post.breakdown.filter((e) => e.label !== 'Distracted');
  return (
    <View testID={testID} style={[styles.card, style]}>
      <View style={styles.head}>
        <Avatar username={post.username} />
        <Text weight="semibold" style={styles.name} numberOfLines={1}>
          {mine ? 'You' : `@${post.username}`}
        </Text>
        <Text variant="small" style={styles.flex} numberOfLines={1}>
          {formatDistanceToNow(post.createdAt, { addSuffix: true })}
        </Text>
        {post.streak > 0 ? <Tag icon="🔥" label={`${post.streak} day${post.streak === 1 ? '' : 's'}`} color="orange" /> : null}
      </View>

      {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}

      <View style={styles.stats}>
        <Stat value={formatDuration(post.totalS)} label="Focus time" />
        <Stat value={`${post.focusPct}%`} label="Focused" />
        {post.pomodoros > 0 ? <Stat value={String(post.pomodoros)} label={post.pomodoros === 1 ? 'Pomodoro' : 'Pomodoros'} /> : null}
        {subjects[0] ? <Stat value={subjects[0].label} label="Top subject" /> : null}
      </View>

      {post.breakdown.length ? <BreakdownBar entries={post.breakdown} legend legendTime height={8} /> : null}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text serif style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="small">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius * 2,
    padding: space.lg,
    backgroundColor: colors.raised,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center', marginRight: space.sm },
  avatarText: { fontFamily: fonts.semibold },
  name: { marginRight: space.sm, maxWidth: 220 },
  flex: { flex: 1 },
  caption: { marginTop: space.md },
  stats: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.md, marginBottom: space.sm },
  stat: { marginRight: space.xxl, marginBottom: space.xs },
  statValue: { fontFamily: fonts.serif, fontSize: 30, lineHeight: 36, color: colors.text },
});
