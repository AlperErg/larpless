/**
 * Delete for a finished session (History rows and the Summary page). Two steps, so one stray click
 * can't delete it; a session that was posted can take its post off the friends' feed too.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { SessionSummary } from '../../contracts/domain';
import { isSessionPosted, useSocialStore } from '../../store/socialStore';
import { deleteSession } from '../lib/actions';
import { errorText } from '../lib/social';
import { space, tag } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

export interface DeleteSessionProps {
  summary: SessionSummary;
  /** Runs after the session is gone, e.g. to leave its Summary page. */
  onDeleted?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function DeleteSession({ summary, onDeleted, style }: DeleteSessionProps) {
  const id = summary.id;
  // Known only for posts in the loaded feed or made since launch; an older post isn't offered.
  const posted = useSocialStore((s) => s.status === 'signedIn' && isSessionPosted(s, id));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (post: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    deleteSession(id, { post }).then(
      // In History the row (and this component) is gone by now, so no state is touched on success.
      () => onDeleted?.(),
      (e: unknown) => {
        setBusy(false);
        setError(post ? `The post wasn't deleted, so the session was kept. ${errorText(e)}` : errorText(e));
      },
    );
  };

  if (!confirming) {
    return <Button testID={`delete-session-${id}`} title="Delete…" variant="danger" onPress={() => setConfirming(true)} style={style} />;
  }

  return (
    <View testID={`delete-session-confirm-${id}`} style={[styles.box, style]}>
      <Text variant="small" style={styles.prompt}>
        {posted ? "Delete this session? It can't be undone. It's also posted to your friends' feed." : "Delete this session? It can't be undone."}
      </Text>
      <View style={styles.row}>
        {posted ? (
          <Button
            testID={`delete-session-with-post-${id}`}
            title={busy ? 'Deleting…' : 'Delete session and post'}
            variant="danger"
            disabled={busy}
            onPress={() => run(true)}
            style={styles.gapRight}
          />
        ) : null}
        <Button
          testID={`delete-session-only-${id}`}
          title={posted ? 'Delete session only' : busy ? 'Deleting…' : 'Delete for good'}
          variant={posted ? 'secondary' : 'danger'}
          disabled={busy}
          onPress={() => run(false)}
          style={styles.gapRight}
        />
        <Button testID={`delete-session-cancel-${id}`} title="Cancel" variant="ghost" disabled={busy} onPress={() => setConfirming(false)} />
      </View>
      {error ? (
        <Text testID={`delete-session-error-${id}`} variant="small" color={tag.red.text} style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexShrink: 1 },
  prompt: { marginBottom: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  gapRight: { marginRight: space.sm },
  error: { marginTop: space.xs },
});
