module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    // `babel-preset-expo` already includes the React Native preset, JSX runtime and
    // Reanimated's plugin; adding any of them separately is what breaks worklets.
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
  };
};
