/**
 * Platform-specific wording for the UI. macOS keeps its glyphs (⌘ / ⌥) and copy; Windows spells shortcuts out
 * (Ctrl+ / Alt+) and says "PC". Anything that isn't Windows gets the macOS values (that includes Jest, which
 * runs as 'ios').
 */
import { Animated, Platform, View } from 'react-native';
import { config } from '../config';

export const IS_WINDOWS = Platform.OS === 'windows';

/** The primary shortcut modifier: "⌘" on macOS, "Ctrl+" on Windows (so `${MOD}K` reads ⌘K / Ctrl+K). */
export const MOD = IS_WINDOWS ? 'Ctrl+' : '⌘';
/** The option modifier: "⌥" on macOS, "Alt+" on Windows. */
export const ALT = IS_WINDOWS ? 'Alt+' : '⌥';
/** What to call the user's computer in copy ("Everything stays on this Mac"). */
export const DEVICE = IS_WINDOWS ? 'PC' : 'Mac';

/** Where the Ollama installer comes from (config points at the macOS .dmg). */
export const OLLAMA_DOWNLOAD_URL = IS_WINDOWS ? 'https://ollama.com/download/OllamaSetup.exe' : config.OLLAMA_DOWNLOAD_URL;
/** Shell command that starts Ollama with the prompt cache off (bash form on macOS, PowerShell on Windows). */
export const OLLAMA_SERVE_COMMAND = IS_WINDOWS ? '$env:LLAMA_ARG_CACHE_RAM=0; ollama serve' : 'LLAMA_ARG_CACHE_RAM=0 ollama serve';
/** The command-line app Ollama is started in by hand. */
export const SHELL_NAME = IS_WINDOWS ? 'PowerShell' : 'Terminal';
/** Where the user finds an installed Ollama if LarpLess can't start it. */
export const APP_LAUNCHER = IS_WINDOWS ? 'the Start menu' : 'Applications';
/** Onboarding: how to run the downloaded installer. */
export const OLLAMA_INSTALL_HINT = IS_WINDOWS
  ? 'Run the downloaded OllamaSetup.exe; this page notices when it’s installed.'
  : 'Open the downloaded Ollama.dmg and drag Ollama into Applications; this page notices when it’s there.';

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
