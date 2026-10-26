import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppStore } from '../../store/appStore';
import { Button, EditableTable, SubjectLibrary, Text } from '../components';
import { Page } from '../layout/Page';
import { courseNameProblem, draftsFromModules, modulesFromDrafts, toggleSubject } from '../lib/modules';
import { useAllModules } from '../lib/useAllModules';
import type { ModuleDraft } from '../lib/modules';
import { space, tag } from '../theme';

const SAVE_DEBOUNCE_MS = 600;

/** Modules (D9): the onboarding table, auto-saved (debounced, and on blur), and which subjects are detected. */
export function ModulesPage() {
  const stored = useAppStore((s) => s.modules);
  const saveModules = useAppStore((s) => s.saveModules);
  const disabled = useAppStore((s) => s.settings.disabledSubjects);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const all = useAllModules();
  const [lastOn, setLastOn] = useState(false);
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

  const setDisabled = (ids: string[]) =>
    updateSettings({ disabledSubjects: ids }).catch((e: unknown) => {
      console.warn('[ui] saving subjects failed:', e instanceof Error ? e.message : String(e));
    });
  const toggle = (id: string) => {
    const next = toggleSubject(disabled, id, all.map((m) => m.id));
    setLastOn(next === null);
    if (next) setDisabled(next);
  };
  const allOn = () => {
    setLastOn(false);
    setDisabled([]);
  };
  const onCount = all.filter((m) => !disabled.includes(m.id)).length;

  const problem = courseNameProblem(drafts);
  return (
    <Page testID="page-modules" header={{ icon: 'library', title: 'Subjects' }}>
      <Text muted style={styles.lead}>
        LarpLess recognises the subjects below automatically. Nothing to set up. If you want sharper labels for a
        specific course, add it here with its course code, topics or lecturer names. Built-in subject names are
        taken, so give your course its own name. Changes save automatically.
      </Text>
      <Text variant="h2" style={styles.h}>
        Your own courses (optional)
      </Text>
      <EditableTable testID="modules-table" rows={drafts} onChange={onChange} onCommit={() => flush(latest.current)} />
      <View style={styles.footer}>
        {problem ? (
          <Text testID="modules-name-problem" variant="small" color={tag.red.text}>
            {problem}
          </Text>
        ) : (
          <Text variant="small" testID="modules-save-state">
            {saved === 'pending' ? 'Saving…' : saved === 'saved' ? 'Saved' : ' '}
          </Text>
        )}
      </View>
      <Text variant="h2" style={[styles.h, styles.libraryTitle]}>
        What LarpLess detects
      </Text>
      <Text muted style={styles.lead}>
        Click a subject to turn it off. LarpLess only labels your time with subjects that are on, and checks run a
        little faster with fewer of them.
      </Text>
      <View style={styles.detectBar}>
        <Text variant="small" testID="modules-detect-count">
          {lastOn ? 'Keep at least one subject on.' : `${onCount} of ${all.length} on`}
        </Text>
        {onCount < all.length ? (
          <Button testID="modules-all-on" title="Turn all on" onPress={allOn} />
        ) : null}
      </View>
      <SubjectLibrary testID="modules-library" courses={stored} disabled={disabled} onToggle={toggle} />
    </Page>
  );
}

const styles = StyleSheet.create({
  lead: { marginBottom: space.lg },
  footer: { marginTop: space.sm, minHeight: 18 },
  h: { marginBottom: space.sm },
  libraryTitle: { marginTop: space.xl },
  detectBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm, minHeight: 28 },
});
