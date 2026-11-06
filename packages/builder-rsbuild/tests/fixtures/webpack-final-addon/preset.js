// `webpackAddons` preset fixture: fails loudly unless `webpackFinal` receives the
// composed Rspack config, then leaves markers the test can assert on.
exports.webpackFinal = async (config) => {
  if (!Array.isArray(config.module?.rules)) {
    throw new Error('webpackFinal did not receive the composed Rspack config')
  }

  config.module.rules.push({ test: /\.webpack-final-marker$/ })
  config.resolve ??= {}
  config.resolve.alias = {
    ...config.resolve.alias,
    '@webpack-final': '/webpack-final',
  }

  return config
}
