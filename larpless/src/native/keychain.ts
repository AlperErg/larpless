import { NativeModules } from 'react-native';
import type { KeychainApi } from '../contracts/native';

const M = NativeModules.FLKeychain;

export const keychain: KeychainApi = {
  // The bridge turns Swift's nil into undefined; the contract says null.
  getItem: (key) => M.getItem(key).then((v: string | null | undefined) => v ?? null),
  setItem: (key, value) => M.setItem(key, value),
  removeItem: (key) => M.removeItem(key),
};
