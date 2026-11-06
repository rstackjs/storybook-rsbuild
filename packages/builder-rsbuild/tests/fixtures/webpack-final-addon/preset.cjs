exports.webpackFinal = (config) => {
  config.module.rules.push({ test: /\.webpack-final$/ })
  return config
}
