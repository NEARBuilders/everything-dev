const { EveryPluginBuild, FixMfDataUriPlugin } = require("every-plugin/build/rspack");

module.exports = {
  plugins: [new EveryPluginBuild({ dts: false }), new FixMfDataUriPlugin()],
};
