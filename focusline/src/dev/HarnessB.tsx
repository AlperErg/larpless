import { StyleSheet, Text, View } from 'react-native';

// Phase 0 placeholder. WS-B owns this file (native shell harness).
export function HarnessB() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Harness B (WS-B)</Text>
    </View>
  );
}

export default HarnessB;

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 18, fontWeight: '600' },
});
