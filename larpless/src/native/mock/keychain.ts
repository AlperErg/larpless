import type { KeychainApi } from '../../contracts/native';

/** In memory, so tests never touch the real Keychain. Values are never logged. */
const items = new Map<string, string>();

export const mockKeychain: KeychainApi & { items: Map<string, string> } = {
  items,
  getItem: async (key) => items.get(key) ?? null,
  setItem: async (key, value) => {
    items.set(key, value);
  },
  removeItem: async (key) => {
    items.delete(key);
  },
};
