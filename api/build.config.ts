import type { PluginBaseConfigOptions } from "every-plugin/build/rspack";

const config: PluginBaseConfigOptions = {
  externals: ["pg", "@electric-sql/pglite", "alchemy", "everything-dev/hosting/docker"],
};

export default config;
