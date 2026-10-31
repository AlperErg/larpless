const config = {
  testPathIgnorePatterns: ['/node_modules/', '/macos/'],
};

const preset = require('@rnx-kit/jest-preset')('windows', config);

// The preset replaces setupFiles with react-native-windows' own; jest.setup.js (mocks, forced mock
// native/classifier) has to run after it, as in jest.config.js.
module.exports = { ...preset, setupFiles: [...preset.setupFiles, '<rootDir>/jest.setup.js'] };
