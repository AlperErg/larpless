/**
 * Platform-specific wording for the UI. macOS keeps its glyphs (⌘ / ⌥) and copy; Windows spells shortcuts out
 * (Ctrl+ / Alt+) and says "PC". Anything that isn't Windows gets the macOS values (that includes Jest, which
 * runs as 'ios').
 */
import { Animated, Platform, View } from 'react-native';

export const IS_WINDOWS = Platform.OS === 'windows';

/** The primary shortcut modifier: "⌘" on macOS, "Ctrl+" on Windows (so `${MOD}K` reads ⌘K / Ctrl+K). */
export const MOD = IS_WINDOWS ? 'Ctrl+' : '⌘';
/** The option modifier: "⌥" on macOS, "Alt+" on Windows. */
export const ALT = IS_WINDOWS ? 'Alt+' : '⌥';
/** What to call the user's computer in copy ("Everything stays on this Mac"). */
export const DEVICE = IS_WINDOWS ? 'PC' : 'Mac';

/**
 * Whether to run Animated transitions. On react-native-windows (Fabric) an Animated.View loses its painted
 * content when it re-renders after the first commit (pages went blank after navigation), even with no
 * animation running. Windows shows the end state instead, rendered by a plain View (MotionView).
 */
export const ANIMATE = !IS_WINDOWS;

/**
 * Animated.View on macOS, a plain View on Windows (see ANIMATE). When ANIMATE is false, pass only static style
 * values (numbers / strings), never Animated.Value or interpolations.
 */
export const MotionView = (ANIMATE ? Animated.View : View) as typeof Animated.View;
