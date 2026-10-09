/* global jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Tests always run against the mocks, whatever the app's live config says (src/config.ts is in
// real mode since checkpoint 2). Unit tests must never touch Swift modules or a running Ollama.
jest.mock('./src/config', () => {
  const actual = jest.requireActual('./src/config');
  return { ...actual, config: { ...actual.config, USE_MOCK_NATIVE: true, USE_MOCK_CLASSIFIER: true } };
});
