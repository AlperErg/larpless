/**
 * Typed access to react-native-macos-only props.
 *
 * TypeScript resolves `react-native` to the core 0.81 types, which don't know the macOS
 * props (onMouseEnter, keyDownEvents, enableFocusRing, tooltip, …). At runtime Metro
 * serves react-native-macos, which supports them. These aliases are the same components,
 * re-typed with the extra props. react-native-windows supports the same props, except that
 * `keyDownEvents` uses a different entry shape: build it with `handledKeys`.
 */
import type { ComponentType, RefAttributes } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import type {
  GestureResponderEvent,
  NativeSyntheticEvent,
  PressableProps,
  TextInputProps,
  ViewProps,
} from 'react-native';

export interface MacKeyEventData {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}
export type MacKeyEvent = NativeSyntheticEvent<MacKeyEventData>;

/** A key the view should handle (macOS `keyDownEvents`). Modifiers default to false. */
export interface HandledKey {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/** react-native-windows names a handled key by its `code` (KeyboardEvent.code) instead of `key`. */
export interface WindowsHandledKey {
  code: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * `keyDownEvents` in the current platform's shape. Named keys (Escape, Enter, ArrowUp, …) share the same
 * spelling for `key` and `code`; single letters map to `KeyX`. onKeyDown events carry `key` on both platforms.
 */
const isWindows = Platform.OS === 'windows';

export function handledKeys(keys: HandledKey[]): HandledKey[] | WindowsHandledKey[] {
  if (!isWindows) return keys;
  return keys.map(({ key, ...modifiers }) => ({
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
    ...modifiers,
  }));
}

interface MacOnlyProps {
  onMouseEnter?: (e: unknown) => void;
  onMouseLeave?: (e: unknown) => void;
  keyDownEvents?: HandledKey[] | WindowsHandledKey[];
  onKeyDown?: (e: MacKeyEvent) => void;
  focusable?: boolean;
  enableFocusRing?: boolean;
  acceptsFirstMouse?: boolean;
  tooltip?: string;
}

export type MacViewProps = ViewProps & MacOnlyProps;
export type MacPressableProps = PressableProps & MacOnlyProps;
export type MacTextInputProps = TextInputProps & MacOnlyProps;

export const MacView = View as unknown as ComponentType<MacViewProps & RefAttributes<View>>;
export const MacPressable = Pressable as unknown as ComponentType<MacPressableProps & RefAttributes<View>>;
export const MacTextInput = TextInput as unknown as ComponentType<MacTextInputProps & RefAttributes<TextInput>>;

/** macOS press events carry modifier flags on the native event. */
export function isAltPress(e: GestureResponderEvent | undefined | null): boolean {
  const ne = e?.nativeEvent as unknown as { altKey?: boolean } | undefined;
  return !!ne?.altKey;
}
