/**
 * Platform-specific wording for the UI. macOS keeps its glyphs (⌘ / ⌥) and copy; Windows spells shortcuts out
 * (Ctrl+ / Alt+) and says "PC". Anything that isn't Windows gets the macOS values (that includes Jest, which
 * runs as 'ios').
 */
import { Platform } from 'react-native';

export const IS_WINDOWS = Platform.OS === 'windows';

/** The primary shortcut modifier: "⌘" on macOS, "Ctrl+" on Windows (so `${MOD}K` reads ⌘K / Ctrl+K). */
export const MOD = IS_WINDOWS ? 'Ctrl+' : '⌘';
/** The option modifier: "⌥" on macOS, "Alt+" on Windows. */
export const ALT = IS_WINDOWS ? 'Alt+' : '⌥';
/** What to call the user's computer in copy ("Everything stays on this Mac"). */
export const DEVICE = IS_WINDOWS ? 'PC' : 'Mac';
