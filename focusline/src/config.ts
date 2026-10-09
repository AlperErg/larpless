import type { Settings } from './contracts/domain';

export const config = {
  USE_MOCK_NATIVE: true,          // flip to false at the 4:00 checkpoint
  USE_MOCK_CLASSIFIER: true,      // true → classifier derives the verdict from windowTitle, no Ollama
  CHUNK_S: 30,
  DEMO_CHUNK_S: 10,
  CAPTURE: { maxWidth: 1280, jpegQuality: 0.7 },
  CLASSIFY_TIMEOUT_MS: 20_000,
  CACHE_TTL_MS: 120_000,
  WEBCAM_FPS: 1,
  SHOW_DEV_TOOLS: __DEV__,
};

export const DEFAULT_SETTINGS: Settings = {
  model: 'qwen3-vl:4b',
  ollamaUrl: 'http://127.0.0.1:11434',
  strictness: 2,
  demoFast: false,
  webcamEnabled: true,
  soundsEnabled: true,
  defaultSound: 'off',
  volume: 0.5,
  pomodoroDefault: 'off',
  onboarded: false,
};
