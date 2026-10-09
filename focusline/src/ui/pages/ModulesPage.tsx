import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppStore } from '../../store/appStore';
import { Callout, EditableTable, Text } from '../components';
import { Page } from '../layout/Page';
import { draftsFromModules, duplicateNames, modulesFromDrafts } from '../lib/modules';
import type { ModuleDraft } from '../lib/modules';
import { space, tag } from '../theme';

const SAVE_DEBOUNCE_MS = 600;

/** Modules (D9): the onboarding table, auto-saved (debounced, and on blur). */
export function ModulesPage() {
  const stored = useAppStore((s) => s.modules);
  const saveModules = useAppStore((s) => s.saveModules);
  const [drafts, setDrafts] = useState<ModuleDraft[]>(() => draftsFromModules(stored));
  const [saved, setSaved] = useState<'idle' | 'pending' | 'saved'>('idle');
  const lastSaved = useRef(JSON.stringify(stored));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest rows, updated synchronously (onCommit can fire right after onChange, before a re-render).
  const latest = useRef(drafts);

  // Re-sync when the store changes from elsewhere (load, fixtures), but not because of our own save.
  useEffect(() => {
    const json = JSON.stringify(stored);
    if (json !== lastSaved.current) {
      lastSaved.current = json;
      latest.current = draftsFromModules(stored);
      setDrafts(latest.current);
    }
  }, [stored]);

  const flush = (rows: ModuleDraft[]) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const mods = modulesFromDrafts(rows);
    const json = JSON.stringify(mods);
    if (json === lastSaved.current) {
      setSaved('idle');
      return;
    }
    lastSaved.current = json;
    saveModules(mods)
      .then(() => setSaved('saved'))
      .catch((e: unknown) => {
        setSaved('idle');
        console.warn('[ui] saveModules failed:', e instanceof Error ? e.message : String(e));
      });
  };

  const onChange = (rows: ModuleDraft[]) => {
    latest.current = rows;
    setDrafts(rows);
    setSaved('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(rows), SAVE_DEBOUNCE_MS);
  };

  // Save anything pending when leaving the page.
  useEffect(
    () => () => {
      if (timer.current) flush(latest.current);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const dups = duplicateNames(drafts);
  return (
    <Page testID="page-modules" header={{ icon: '📚', title: 'Modules' }}>
      <Text muted style={styles.lead}>
        Each module is a subject the model can recognise. Keywords — course codes, topics, lecturer names — make it more
        accurate. Changes save automatically.
      </Text>
      {drafts.length === 0 ? (
        <Callout testID="modules-empty" emoji="📚" style={styles.callout}>
          <Text>No modules yet. Click “＋ New” to add your first subject.</Text>
        </Callout>
      ) : null}
      <EditableTable testID="modules-table" rows={drafts} onChange={onChange} onCommit={() => flush(latest.current)} />
      <View style={styles.footer}>
        {dups.length ? (
          <Text variant="small" color={tag.red.text}>{`Names must be unique: ${dups.join(', ')}`}</Text>
        ) : (
          <Text variant="small" testID="modules-save-state">
            {saved === 'pending' ? 'Saving…' : saved === 'saved' ? 'Saved' : ' '}
          </Text>
        )}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: space.lg },
  callout: { marginBottom: space.lg },
  footer: { marginTop: space.sm, minHeight: 18 },
});
