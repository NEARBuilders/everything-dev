import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EmitPluginManifest,
  EveryPluginDevServer,
  FixMfDataUriPlugin,
} from "every-plugin/build/rspack";
import { computeSriHashForUrl, findPluginKey, writeDeployResult } from "everything-dev/integrity";
import { withZephyr } from "zephyr-rspack-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const shouldDeploy = process.env.DEPLOY === "true";
const bosConfigPath = path.resolve(__dirname, "../../bos.config.json");

const baseConfig = {
  devtool: shouldDeploy ? false : "source-map",
  plugins: [
    new EmitPluginManifest(),
    new EveryPluginDevServer({ dts: false }),
    new FixMfDataUriPlugin(),
  ],
  infrastructureLogging: {
    level: "error",
  },
  stats: "errors-warnings",
};

export default shouldDeploy
  ? withZephyr({
      hooks: {
        onDeployComplete: async (info) => {
          console.log("🚀 Plugin Deployed:", info.url);
          const integrity = await computeSriHashForUrl(info.url);
          const key = findPluginKey(bosConfigPath, __dirname);
          if (!key) {
            console.warn("   ⚠️  No matching plugin entry found for", __dirname);
            return;
          }
          writeDeployResult({
            url: info.url,
            integrity: integrity ?? undefined,
            bosConfigPath,
            urlField: `plugins.${key}.production`,
            integrityField: `plugins.${key}.integrity`,
            label: `plugin-${key}`,
          });
        },
      },
    })(baseConfig)
  : baseConfig;
