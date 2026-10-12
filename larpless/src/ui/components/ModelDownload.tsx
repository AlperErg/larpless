import { StyleSheet, View } from 'react-native';
import { useOllamaStore } from '../../store/ollamaStore';
import { formatBytes } from '../lib/format';
import { space, tag } from '../theme';
import { Button } from './Button';
import { ProgressBar } from './ProgressBar';
import { Text } from './Text';

/**
 * "Download model" button that pulls settings.model through Ollama and shows its progress. The download
 * lives in the Ollama store, so it carries on when this unmounts.
 */
export function ModelDownload({ testID = 'model-download' }: { testID?: string }) {
  const pull = useOllamaStore((s) => s.pull);
  const pullModel = useOllamaStore((s) => s.pullModel);
  const cancelPull = useOllamaStore((s) => s.cancelPull);

  if (pull.status === 'pulling') {
    const frac = pull.total > 0 ? pull.completed / pull.total : null;
    const line =
      frac === null
        ? 'Starting download…'
        : frac >= 1
          ? 'Checking the download…'
          : `${formatBytes(pull.completed)} of ${formatBytes(pull.total)} · ${Math.floor(frac * 100)}%`;
    return (
      <View testID={testID} style={styles.box}>
        <ProgressBar testID={`${testID}-bar`} value={frac} />
        <View style={styles.row}>
          <Text testID={`${testID}-progress`} variant="small" style={styles.flex}>
            {line}
          </Text>
          <Button testID={`${testID}-cancel`} title="Cancel" variant="ghost" onPress={cancelPull} />
        </View>
      </View>
    );
  }

  return (
    <View testID={testID}>
      <View style={styles.row}>
        <Button
          testID={`${testID}-start`}
          title={pull.status === 'error' ? 'Try again' : 'Download model'}
          icon="download"
          variant="primary"
          onPress={() => {
            pullModel().catch(() => {});
          }}
        />
      </View>
      {pull.status === 'error' ? (
        <Text testID={`${testID}-error`} variant="small" color={tag.red.text} style={styles.error}>
          {`Download failed: ${pull.message}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', maxWidth: 420 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs },
  flex: { flex: 1 },
  error: { marginTop: space.xs },
});
