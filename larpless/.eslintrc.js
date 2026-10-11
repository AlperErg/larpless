module.exports = {
  root: true,
  extends: '@react-native',
  // Xcode/CMake build output (CMake writes compiler_depend.ts files that are not TypeScript).
  ignorePatterns: ['macos/build/'],
};
