import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Callout } from '../components/Callout';
import { Text } from '../components/Text';
import { space } from '../theme';

/** Render errors caught by page boundaries (dev introspection: __FL.ui.errors()). */
export const caughtErrors: { at: number; where: string; message: string }[] = [];

interface Props {
  where: string;
  children?: ReactNode;
}
interface State {
  error: Error | null;
}

/** Keeps one broken page from taking down the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    caughtErrors.push({ at: Date.now(), where: this.props.where, message: String(error?.message ?? error) });
    console.error(`[ui] render error in ${this.props.where}:`, error?.message, info?.componentStack?.split('\n').slice(0, 4).join(' | '));
  }

  componentDidUpdate(prev: Props) {
    if (prev.where !== this.props.where && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.box}>
          <Callout emoji="🧯" tone="red">
            <Text weight="semibold">This page hit a snag.</Text>
            <Text variant="small">{String(this.state.error.message)}</Text>
          </Callout>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  box: { padding: space.xxxl },
});
