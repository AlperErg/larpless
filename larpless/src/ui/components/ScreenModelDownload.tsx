import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SCREEN_MODEL_BYTES } from '../../core/screenModel';
import { useScreenModelStore } from '../../store/screenModelStore';
import { formatBytes } from '../lib/format';
import { space, tag } from '../theme';
import { Button } from './Button';
import { Callout } from './Callout';
import { ProgressBar } from './ProgressBar';
import { Text } from './Text';

/**
 * Downloads the on-device screen model (FLScreenModel, Windows) and shows its progress. Renders nothing where
 * the module isn't supported. The download lives in the store, so it carries on when this unmounts.
 */
export function ScreenModelDownload({ testID = 'screen-model-download' }: { testID?: string }) {
  const status = useScreenModelStore((s) => s.status);
  const download = useScreenModelStore((s) => s.download);
  const refresh = useScreenModelStore((s) => s.refresh);
  const start = useScreenModelStore((s) => s.downloadModels);
  const cancel = useScreenModelStore((s) => s.cancelDownload);
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  if (!status?.supported) return null;
  if (status.installed && download.status !== 'pulling') {
    return (
      <Callout testID={`${testID}-ready`} icon="check" tone="green">
        <Text>The fast on-device classifier is ready. It answers most checks in under a second.</Text>
      </Callout>
    );
  }
  if (download.status === 'pulling') {
    const frac = download.total > 0 ? download.completed / download.total : null;
    return (
      <View testID={testID} style={styles.box}>
        <ProgressBar testID={`${testID}-bar`} value={frac} />
        <View style={styles.row}>
          <Text testID={`${testID}-progress`} variant="small" style={styles.flex}>
            {frac === null ? 'Starting download…' : `${formatBytes(download.completed)} of ${formatBytes(download.total)} · ${Math.floor(frac * 100)}%`}
          </Text>
          <Button testID={`${testID}-cancel`} title="Cancel" variant="ghost" onPress={cancel} />
        </View>
      </View>
    );
  }
  return (
    <View testID={testID}>
      <Text variant="small">{`Fast on-device classifier: a one-time download of about ${formatBytes(SCREEN_MODEL_BYTES)}. It reads your screen in under a second without Ollama, and nothing leaves this PC.`}</Text>
      <View style={styles.row}>
        <Button
          testID={`${testID}-start`}
          title={download.status === 'error' ? 'Try again' : 'Download classifier'}
          icon="download"
          variant="primary"
          onPress={() => {
            start().catch(() => {});
          }}
        />
      </View>
      {download.status === 'error' ? (
        <Text testID={`${testID}-error`} variant="small" color={tag.red.text} style={styles.error}>
          {`Download failed: ${download.message}`}
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
