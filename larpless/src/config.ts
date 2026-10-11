import type { Settings } from './contracts/domain';

export const config = {
  USE_MOCK_NATIVE: false,          // flip to false at the 4:00 checkpoint
  USE_MOCK_CLASSIFIER: false,      // true → classifier derives the verdict from windowTitle, no Ollama
  CAPTURE: { maxWidth: 1280, jpegQuality: 0.7 }, // fallback when a caller has no power profile; live sessions use the profile
  CLASSIFY_TIMEOUT_MS: 30_000, // ceiling so a slow machine can finish; profiles change cadence, not this
  CACHE_TTL_MS: 120_000,
  WEBCAM_FPS: 1,
  SHOW_DEV_TOOLS: __DEV__,
  OLLAMA_DOWNLOAD_URL: 'https://ollama.com/download/Ollama.dmg',
  /** Shown before a model download starts; Ollama reports the real size once it begins. */
  MODEL_SIZES: { 'qwen3-vl:4b': '3.3 GB' } as Record<string, string>,
};

export const DEFAULT_SETTINGS: Settings = {
  model: 'qwen3-vl:4b',
  ollamaUrl: 'http://127.0.0.1:11434',
  strictness: 2,
  powerProfile: 'medium',
  demoFast: false,
  webcamEnabled: true,
  nowPlayingEnabled: true,
  soundsEnabled: true,
  defaultSound: 'off',
  volume: 0.5,
  pomodoroDefault: 'off',
  onboarded: false,
  appearance: 'system',
};
