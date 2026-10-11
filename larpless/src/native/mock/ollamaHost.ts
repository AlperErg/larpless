import type { OllamaHostApi } from '../../contracts/native';

/** Ollama.app installed and serving with the prompt cache already off, so prepare() never acts. */
export const mockOllamaHost: OllamaHostApi = {
  info: async () => ({ appInstalled: true, cliInstalled: true, appRunning: true, server: 'app', promptCache: 'off' }),
  launch: async () => {
    console.log('[mock ollamaHost] launch');
  },
  restart: async () => {
    console.log('[mock ollamaHost] restart');
  },
  quit: async () => {
    console.log('[mock ollamaHost] quit');
  },
};
