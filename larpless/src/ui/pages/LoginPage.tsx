/** Signed-out Friends: a sign-in screen, and a separate create-account screen. */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Animated, Easing, View } from 'react-native';
import { useNavStore } from '../../store/navStore';
import { useSocialStore } from '../../store/socialStore';
import { Button, Callout, Text } from '../components';
import { TextField } from '../components/TextField';
import { Page } from '../layout/Page';
import { errorText } from '../lib/social';
import { colors, motion, space, tag, themed } from '../theme';

type AuthScreen = 'signIn' | 'signUp';

export function AuthGate() {
  const status = useSocialStore((s) => s.status);
  const screen: AuthScreen = useNavStore((s) => (s.params.auth === 'signUp' ? 'signUp' : 'signIn'));
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status !== 'signedIn') return;
    const nav = useNavStore.getState();
    if (nav.route === 'login') nav.go('feed');
  }, [status]);

  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: motion.base, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => fade.stopAnimation();
  }, [screen, fade]);

  const show = (next: AuthScreen) => {
    const nav = useNavStore.getState();
    nav.go(nav.route, { ...nav.params, auth: next });
  };

  if (status === 'unconfigured') {
    return (
      <Page testID="page-login" header={{ icon: 'users', title: 'Friends' }}>
        <Callout icon="alert" tone="orange">
          <Text>Supabase isn't configured. Add the project URL and anon key to src/social/env.ts.</Text>
        </Callout>
      </Page>
    );
  }

  return (
    <Animated.View style={[styles.fill, { opacity: fade }]}>
      {screen === 'signUp' ? <SignupPage onSignIn={() => show('signIn')} /> : <LoginPage onCreateAccount={() => show('signUp')} />}
    </Animated.View>
  );
}

export function LoginPage({ onCreateAccount }: { onCreateAccount: () => void }) {
  const status = useSocialStore((s) => s.status);
  const signIn = useSocialStore((s) => s.signIn);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    signIn(username, password)
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Page testID="page-login" header={{ icon: 'key', title: 'Sign in' }}>
      <Text muted>Share finished sessions with friends and see how they're studying. Only the stats you post leave this Mac.</Text>
      <View style={styles.card}>
        <Field label="Username or email" testID="login-username" value={username} onChangeText={setUsername} placeholder="e.g. ada_l" onSubmit={submit} />
        <Field label="Password" testID="login-password" value={password} onChangeText={setPassword} secure onSubmit={submit} />
        {error ? <ErrorLine testID="login-error" text={error} /> : null}
        <Button
          testID="login-submit"
          title={busy ? 'One moment…' : 'Sign in'}
          variant="primary"
          disabled={busy || status === 'loading'}
          onPress={submit}
          style={styles.submit}
        />
        <View style={styles.switchRow}>
          <Text variant="small">New here?</Text>
          <Button testID="login-create" title="Create an account" variant="ghost" onPress={onCreateAccount} />
        </View>
      </View>
    </Page>
  );
}

export function SignupPage({ onSignIn }: { onSignIn: () => void }) {
  const status = useSocialStore((s) => s.status);
  const signUp = useSocialStore((s) => s.signUp);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (busy) return;
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    signUp(username, password)
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Page testID="page-signup" header={{ icon: 'sparkles', title: 'Create account' }}>
      <Text muted>Pick a username friends can add. Only the stats you post leave this Mac.</Text>
      <View style={styles.card}>
        <NameMark username={username} />
        <Field label="Username" testID="signup-username" value={username} onChangeText={setUsername} placeholder="e.g. ada_l" onSubmit={submit} />
        <Field
          label="Password"
          testID="signup-password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          secure
          onSubmit={submit}
        />
        <Field label="Confirm password" testID="signup-confirm" value={confirm} onChangeText={setConfirm} placeholder="Type it again" secure onSubmit={submit} />
        {error ? <ErrorLine testID="signup-error" text={error} /> : null}
        <Button
          testID="signup-submit"
          title={busy ? 'One moment…' : 'Create account'}
          variant="primary"
          disabled={busy || status === 'loading'}
          onPress={submit}
          style={styles.submit}
        />
        <Text variant="small" style={styles.hint}>
          Friends add you by your username. It's 3–20 letters, numbers or underscores.
        </Text>
        <View style={styles.switchRow}>
          <Text variant="small">Already have an account?</Text>
          <Button testID="signup-signin" title="Sign in" variant="ghost" onPress={onSignIn} />
        </View>
      </View>
    </Page>
  );
}

function NameMark({ username }: { username: string }) {
  const name = username.trim().replace(/^@/, '').toLowerCase();
  return (
    <Text testID="signup-name" serif numberOfLines={1} style={styles.markName} color={name ? colors.text : colors.faint}>
      {name ? `@${name}` : '@username'}
    </Text>
  );
}

function Field({
  label,
  testID,
  value,
  onChangeText,
  placeholder,
  secure,
  onSubmit,
}: {
  label: string;
  testID: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  onSubmit: () => void;
}) {
  return (
    <>
      <Text variant="small" style={styles.label}>
        {label}
      </Text>
      <TextField
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={secure}
        onSubmitEditing={onSubmit}
        style={styles.inset}
      />
    </>
  );
}

function ErrorLine({ testID, text }: { testID: string; text: string }) {
  return (
    <Text testID={testID} variant="small" color={tag.red.text} style={styles.error}>
      {text}
    </Text>
  );
}

const styles = themed(() => StyleSheet.create({
  fill: { flex: 1 },
  card: {
    marginTop: space.xl,
    maxWidth: 360,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    backgroundColor: colors.raised,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  markName: { fontSize: 28, lineHeight: 34, letterSpacing: -0.4, marginTop: space.lg },
  inset: { backgroundColor: colors.bg },
  label: { marginTop: space.md, marginBottom: space.xs, color: colors.muted },
  error: { marginTop: space.sm },
  submit: { marginTop: space.lg, alignSelf: 'stretch' },
  hint: { marginTop: space.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
}));
