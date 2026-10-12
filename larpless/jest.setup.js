/* global jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// ESM-only package; Node already provides URL in tests.
jest.mock('react-native-url-polyfill/auto', () => ({}));
// ESM-only icon package. Tests render a stand-in view for every glyph.
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Glyph = (props) => React.createElement(View, props);
  return new Proxy({ __esModule: true }, { get: (_target, key) => (key === '__esModule' ? true : Glyph) });
});
// Lucide icons draw through react-native-svg. Tests only need a host view.
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Mock = (props) => React.createElement(View, props);
  return new Proxy(
    { __esModule: true, default: Mock },
    { get: (target, key) => (key in target ? target[key] : Mock) },
  );
});

// Tests always run against the mocks, whatever the app's live config says (src/config.ts is in
// real mode since checkpoint 2). Unit tests must never touch Swift modules or a running Ollama.
jest.mock('./src/config', () => {
  const actual = jest.requireActual('./src/config');
  return { ...actual, config: { ...actual.config, USE_MOCK_NATIVE: true, USE_MOCK_CLASSIFIER: true } };
});
