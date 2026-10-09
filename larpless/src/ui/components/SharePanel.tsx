/** "Post to friends" on the Summary page. Sends stats only: time, focus %, breakdown, streak, caption. */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { BreakdownEntry, SessionSummary } from '../../contracts/domain';
import { streak } from '../../core/focus';
import { MAX_CAPTION } from '../../social/api';
import { useAppStore } from '../../store/appStore';
import { useNavStore } from '../../store/navStore';
import { isSessionPosted, useSocialStore } from '../../store/socialStore';
import { errorText } from '../lib/social';
import { space, tag } from '../theme';
import { Button } from './Button';
import { Callout } from './Callout';
import { Text } from './Text';
import { TextField } from './TextField';

export interface SharePanelProps {
  summary: SessionSummary;
  breakdown: BreakdownEntry[];
  focusPct: number;
  style?: StyleProp<ViewStyle>;
}

export function SharePanel({ summary, breakdown, focusPct, style }: SharePanelProps) {
  const status = useSocialStore((s) => s.status);
  const posted = useSocialStore((s) => isSessionPosted(s, summary.id));
  const publish = useSocialStore((s) => s.publish);
  const sessions = useAppStore((s) => s.sessions);
  const go = useNavStore((s) => s.go);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'unconfigured' || status === 'loading') return null;

  if (status === 'signedOut') {
    return (
      <Callout testID="share-signin" emoji="👥" style={style}>
        <Text>Sign in to share this session with your friends.</Text>
        <Button title="Sign in" variant="secondary" onPress={() => go('feed')} style={styles.calloutButton} />
      </Callout>
    );
  }

  if (posted) {
    return (
      <Callout testID="share-posted" emoji="✅" tone="green" style={style}>
        <Text>Posted to your friends' feed.</Text>
        <Button title="View feed" variant="secondary" onPress={() => go('feed')} style={styles.calloutButton} />
      </Callout>
    );
  }

  const post = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    publish({ summary, breakdown, focusPct, streak: streak(sessions, summary.endedAt), caption })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };

  return (
    <View testID="share-panel" style={style}>
      <Text weight="semibold">Share with friends</Text>
      <Text variant="small" style={styles.note}>
        Posts your focus time, focus %, subject breakdown and streak. Nothing from your screen or camera.
      </Text>
      <View style={styles.row}>
        <TextField
          testID="share-caption"
          value={caption}
          onChangeText={setCaption}
          maxLength={MAX_CAPTION}
          placeholder="Add a caption (optional)"
          onSubmitEditing={post}
          style={styles.caption}
        />
        <Button
          testID="share-post"
          title={busy ? 'Posting…' : 'Post to friends'}
          icon="📤"
          variant="primary"
          disabled={busy}
          onPress={post}
          style={styles.gapLeft}
        />
      </View>
      {error ? (
        <Text testID="share-error" variant="small" color={tag.red.text} style={styles.note}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  caption: { flex: 1, maxWidth: 420 },
  gapLeft: { marginLeft: space.md },
  note: { marginTop: space.xs },
  calloutButton: { marginTop: space.sm },
});
