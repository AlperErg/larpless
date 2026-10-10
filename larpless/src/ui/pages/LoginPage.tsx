/** Sign in or create an account (username + password). Shown by the Friends tab when signed out. */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavStore } from '../../store/navStore';
import { useSocialStore } from '../../store/socialStore';
import { Button, Callout, Segmented, Text } from '../components';
import { TextField } from '../components/TextField';
import { Page } from '../layout/Page';
import { errorText } from '../lib/social';
import { colors, space, tag } from '../theme';
import { DEVICE } from '../platform';

type Mode = 'signIn' | 'signUp';

export function LoginPage() {
  const status = useSocialStore((s) => s.status);
  const signIn = useSocialStore((s) => s.signIn);
  const signUp = useSocialStore((s) => s.signUp);
  const [mode, setMode] = useState<Mode>('signIn');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nav = useNavStore.getState();
    if (status === 'signedIn' && nav.route === 'login') nav.go('feed');
  }, [status]);

  const submit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    (mode === 'signIn' ? signIn : signUp)(username, password)
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Page testID="page-login" header={{ icon: '👥', title: 'Friends' }}>
      <Text muted>{`Share finished sessions with friends and see how they're studying. Only the stats you post leave this ${DEVICE}.`}</Text>

      {status === 'unconfigured' ? (
        <Callout emoji="⚠️" tone="orange" style={styles.block}>
          <Text>Supabase isn't configured. Add the project URL and anon key to src/social/env.ts.</Text>
        </Callout>
      ) : (
        <View style={styles.form}>
          <Segmented<Mode>
            testID="login-mode"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: 'signIn', label: 'Sign in' },
              { value: 'signUp', label: 'Create account' },
            ]}
          />
          <Text variant="small" style={styles.label}>
            {mode === 'signIn' ? 'Username or email' : 'Username'}
          </Text>
          <TextField
            testID="login-username"
            value={username}
            onChangeText={setUsername}
            placeholder="e.g. ada_l"
            onSubmitEditing={submit}
          />
          <Text variant="small" style={styles.label}>
            Password
          </Text>
          <TextField
            testID="login-password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder={mode === 'signUp' ? 'At least 6 characters' : ''}
            onSubmitEditing={submit}
          />
          {error ? (
            <Text testID="login-error" variant="small" color={tag.red.text} style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Button
            testID="login-submit"
            title={busy ? 'One moment…' : mode === 'signIn' ? 'Sign in' : 'Create account'}
            variant="primary"
            disabled={busy || status === 'loading'}
            onPress={submit}
            style={styles.submit}
          />
          {mode === 'signUp' ? (
            <Text variant="small" style={styles.hint}>
              Friends add you by your username. It's 3–20 letters, numbers or underscores.
            </Text>
          ) : null}
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: space.lg },
  form: { marginTop: space.xl, maxWidth: 320 },
  label: { marginTop: space.md, marginBottom: space.xs, color: colors.muted },
  error: { marginTop: space.sm },
  submit: { marginTop: space.lg },
  hint: { marginTop: space.md },
});
