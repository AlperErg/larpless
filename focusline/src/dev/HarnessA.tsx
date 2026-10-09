import { StyleSheet, Text, View } from 'react-native';

// Phase 0 placeholder. WS-A owns this file (native capture harness).
export function HarnessA() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Harness A (WS-A)</Text>
    </View>
  );
}

export default HarnessA;

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 18, fontWeight: '600' },
});
