import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { PomodoroCustom, PomodoroPreset } from '../../contracts/domain';
import { CUSTOM_LIMITS, cleanCustom } from '../../core/pomodoro';
import { POMODORO_OPTIONS } from '../lib/labels';
import { IS_WINDOWS } from '../platform';
import { colors, layout, radius, space, themed } from '../theme';
import { Button } from './Button';
import { Segmented } from './Segmented';
import { Text } from './Text';

export interface PomodoroPickerProps {
  value: PomodoroPreset | 'off';
  custom: PomodoroCustom;
  onChange: (v: PomodoroPreset | 'off') => void;
  onCustomChange: (c: PomodoroCustom) => void;
  /** Chips get `${testID}-<value>`, the editor `${testID}-custom-*`. */
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Off / 25/5 / 50/10 / Custom. Picking Custom opens the study and break length editor under the chips. */
export function PomodoroPicker({ value, custom, onChange, onCustomChange, testID = 'pomodoro-preset', style }: PomodoroPickerProps) {
  return (
    <View style={style}>
      <Segmented testID={testID} options={POMODORO_OPTIONS} value={value} onChange={onChange} />
      {value === 'custom' ? (
        <View testID={`${testID}-custom`} style={styles.editor}>
          <MinutesField
            testID={`${testID}-custom-focus`}
            label="Study"
            value={custom.focusMin}
            step={5}
            limits={CUSTOM_LIMITS.focusMin}
            onChange={(focusMin) => onCustomChange(cleanCustom({ ...custom, focusMin }))}
          />
          <MinutesField
            testID={`${testID}-custom-break`}
            label="Break"
            value={custom.breakMin}
            step={1}
            limits={CUSTOM_LIMITS.breakMin}
            onChange={(breakMin) => onCustomChange(cleanCustom({ ...custom, breakMin }))}
          />
        </View>
      ) : null}
    </View>
  );
}

interface MinutesFieldProps {
  label: string;
  value: number;
  step: number;
  limits: { min: number; max: number };
  onChange: (v: number) => void;
  testID: string;
}

/**
 * On Windows a clicked button keeps keyboard focus. Picking another preset then unmounts the focused button,
 * Windows moves focus to the first control on the page and the Settings scroll view jumps to the top.
 */
const STEPPER_FOCUSABLE = IS_WINDOWS ? false : undefined;

/** Next value a −/+ press lands on: snaps to the step grid (e.g. 52 + 5 → 55), within the limits. */
function stepTo(value: number, step: number, dir: 1 | -1, limits: { min: number; max: number }): number {
  const next = dir > 0 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step;
  return Math.min(limits.max, Math.max(limits.min, next));
}

/** − [ n ] + min. A plain rounded box rather than a text input: no I-beam cursor and no square native fill on Windows. */
function MinutesField({ label, value, step, limits, onChange, testID }: MinutesFieldProps) {
  return (
    <View style={styles.row}>
      <Text variant="small" style={styles.label}>
        {label}
      </Text>
      <Button
        testID={`${testID}-minus`}
        title="−"
        variant="ghost"
        focusable={STEPPER_FOCUSABLE}
        disabled={value <= limits.min}
        onPress={() => onChange(stepTo(value, step, -1, limits))}
      />
      <View testID={testID} accessibilityLabel={`${label} ${value} minutes`} style={styles.box}>
        <Text style={styles.value}>{String(value)}</Text>
      </View>
      <Button
        testID={`${testID}-plus`}
        title="+"
        variant="ghost"
        focusable={STEPPER_FOCUSABLE}
        disabled={value >= limits.max}
        onPress={() => onChange(stepTo(value, step, 1, limits))}
      />
      <Text variant="small" muted>
        min
      </Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  editor: { marginTop: space.sm, flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', marginRight: space.lg, marginVertical: 2 },
  label: { width: 40 },
  box: {
    minWidth: 52,
    height: layout.controlHeight,
    marginHorizontal: space.xs,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { fontVariant: ['tabular-nums'] },
}));
