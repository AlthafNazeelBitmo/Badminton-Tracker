const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '../..');

/**
 * Jest for a React Native app inside an npm workspace.
 *
 * The awkward part is `transformIgnorePatterns`. Jest skips `node_modules` by default,
 * but React Native and every Expo package ship untranspiled ES modules and JSX, so they
 * have to be transformed or the first import fails with a syntax error. npm hoists them
 * to the workspace root, so the pattern has to match a path *outside* this project.
 */
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src', '<rootDir>/app'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    `${workspaceRoot}/node_modules/(?!(?:jest-)?react-native|@react-native|@react-navigation|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-native-svg|react-native-gesture-handler|react-native-reanimated|react-native-safe-area-context|react-native-screens|react-native-worklets|@shopify/flash-list)`,
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  // The offline sync tests drive a real in-memory SQLite database through many steps.
  testTimeout: 20_000,
};
