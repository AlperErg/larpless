/**
 * Typed access to react-native-macos-only props.
 *
 * TypeScript resolves `react-native` to the core 0.81 types, which don't know the macOS
 * props (onMouseEnter, keyDownEvents, enableFocusRing, tooltip, …). At runtime Metro
 * serves react-native-macos, which supports them. These aliases are the same components,
 * re-typed with the extra props.
 */
import type { ComponentType, RefAttributes } from 'react';
import { Pressable, TextInput, View } from 'react-native';
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

interface MacOnlyProps {
  onMouseEnter?: (e: unknown) => void;
  onMouseLeave?: (e: unknown) => void;
  keyDownEvents?: HandledKey[];
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
