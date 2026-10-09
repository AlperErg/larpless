/* global jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// ESM-only package; Node already provides URL in tests.
jest.mock('react-native-url-polyfill/auto', () => ({}));
