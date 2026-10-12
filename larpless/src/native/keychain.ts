import { NativeModules } from 'react-native';
import type { KeychainApi } from '../contracts/native';

const M = NativeModules.FLKeychain;

export const keychain: KeychainApi = {
  getItem: (key) => M.getItem(key),
  setItem: (key, value) => M.setItem(key, value),
  removeItem: (key) => M.removeItem(key),
};
