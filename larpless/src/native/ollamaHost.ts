import { NativeModules } from 'react-native';
import type { OllamaHostApi } from '../contracts/native';

const M = NativeModules.FLOllama;

export const ollamaHost: OllamaHostApi = {
  info: () => M.info(),
  launch: () => M.launch(),
  restart: () => M.restart(),
  quit: () => M.quit(),
};
