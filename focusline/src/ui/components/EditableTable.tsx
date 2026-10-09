import { useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, fonts, radius, space } from '../theme';
import type { ModuleDraft } from '../lib/modules';
import { blankDraft, nextTagColor } from '../lib/modules';
import { MacPressable, MacTextInput, MacView } from './mac';
import { Tag } from './Tag';

export interface EditableTableProps {
  rows: ModuleDraft[];
  onChange: (rows: ModuleDraft[]) => void;
  /** Called when a cell loses focus (good moment to persist). */
  onCommit?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Notion-style table for modules: Name | Colour | Keywords, hairline grid, "＋ New" row. */
export function EditableTable({ rows, onChange, onCommit, testID, style }: EditableTableProps) {
  const update = (id: string, patch: Partial<ModuleDraft>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => {
    onChange(rows.filter((r) => r.id !== id));
    onCommit?.();
  };
  const add = () => onChange([...rows, blankDraft(rows.map((r) => r.color))]);

  return (
    <View testID={testID} style={[styles.table, style]}>
      <View style={[styles.row, styles.headerRow]}>
        <HeaderCell icon="Aa" label="Name" style={styles.colName} />
        <HeaderCell icon="◎" label="Colour" style={styles.colColor} />
        <HeaderCell icon="≡" label="Keywords" style={styles.colKeywords} last />
      </View>
      {rows.map((r) => (
        <Row
          key={r.id}
          row={r}
          onName={(name) => update(r.id, { name })}
          onKeywords={(keywordsText) => update(r.id, { keywordsText })}
          onCycleColor={() => {
            update(r.id, { color: nextTagColor(r.color) });
            onCommit?.();
          }}
          onRemove={() => remove(r.id)}
          onBlur={onCommit}
        />
      ))}
      <NewRow onPress={add} />
    </View>
  );
}

function HeaderCell({ icon, label, style, last }: { icon: string; label: string; style: StyleProp<ViewStyle>; last?: boolean }) {
  return (
    <View style={[styles.cell, last ? null : styles.cellDivider, style]}>
      <RNText style={styles.headerText}>
        <RNText style={styles.headerIcon}>{icon}</RNText>
        {'  '}
        {label}
      </RNText>
    </View>
  );
}

function Row({
  row,
  onName,
  onKeywords,
  onCycleColor,
  onRemove,
  onBlur,
}: {
  row: ModuleDraft;
  onName: (v: string) => void;
  onKeywords: (v: string) => void;
  onCycleColor: () => void;
  onRemove: () => void;
  onBlur?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <MacView
      testID={`module-row-${row.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={[styles.row, hover ? styles.rowHover : null]}>
      <View style={[styles.cell, styles.cellDivider, styles.colName]}>
        <MacTextInput
          testID="module-name"
          value={row.name}
          onChangeText={onName}
          onBlur={onBlur}
          placeholder="Untitled"
          placeholderTextColor={colors.faint}
          enableFocusRing={false}
          style={[styles.input, styles.inputName]}
        />
      </View>
      <MacPressable
        testID="module-color"
        accessibilityRole="button"
        accessibilityLabel={`Colour ${row.color}, click to change`}
        tooltip="Click to change colour"
        enableFocusRing={false}
        onPress={onCycleColor}
        style={[styles.cell, styles.cellDivider, styles.colColor, styles.colorCell]}>
        <Tag label={row.color} color={row.color} />
      </MacPressable>
      <View style={[styles.cell, styles.colKeywords, styles.keywordsCell]}>
        <MacTextInput
          testID="module-keywords"
          value={row.keywordsText}
          onChangeText={onKeywords}
          onBlur={onBlur}
          placeholder="cell, mitosis, BIO101"
          placeholderTextColor={colors.faint}
          enableFocusRing={false}
          style={[styles.input, styles.flex]}
        />
        <MacPressable
          testID="module-remove"
          accessibilityRole="button"
          accessibilityLabel="Delete row"
          tooltip="Delete"
          enableFocusRing={false}
          onPress={onRemove}
          style={[styles.remove, hover ? null : styles.invisible]}>
          <RNText style={styles.removeText}>×</RNText>
        </MacPressable>
      </View>
    </MacView>
  );
}

function NewRow({ onPress }: { onPress: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <MacPressable
      testID="module-new"
      accessibilityRole="button"
      enableFocusRing={false}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[styles.newRow, hover ? styles.rowHover : null]}>
      <RNText style={styles.newText}>＋ New</RNText>
    </MacPressable>
  );
}

const styles = StyleSheet.create({
  table: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    minHeight: 34,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerRow: { minHeight: 32 },
  rowHover: { backgroundColor: colors.hover },
  cell: { justifyContent: 'center', paddingHorizontal: space.sm },
  cellDivider: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  colName: { width: 200 },
  colColor: { width: 120 },
  colKeywords: { flex: 1 },
  colorCell: { alignItems: 'flex-start' },
  keywordsCell: { flexDirection: 'row', alignItems: 'center' },
  headerText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted },
  headerIcon: { fontFamily: fonts.medium, fontSize: 11, color: colors.faint },
  input: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    paddingVertical: 6,
    paddingHorizontal: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  inputName: { fontFamily: fonts.medium },
  flex: { flex: 1 },
  remove: { width: 22, height: 22, borderRadius: radius, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: 16, lineHeight: 18, color: colors.muted },
  invisible: { opacity: 0 },
  newRow: { height: 32, justifyContent: 'center', paddingHorizontal: space.sm },
  newText: { fontFamily: fonts.regular, fontSize: 14, color: colors.faint },
});
