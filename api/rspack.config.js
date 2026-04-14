import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EveryPluginDevServer, FixMfDataUriPlugin } from "every-plugin/build/rspack";
import { withZephyr } from "zephyr-rspack-plugin";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const shouldDeploy = process.env.DEPLOY === "true";

function updateHostConfig(name, url) {
  try {
    const configPath = path.resolve(__dirname, "../bos.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

    if (config.app.api.name !== name) {
      console.error(`   ❌ API "${name}" not found in bos.config.json`);
      return;
    }

    config.app.api.production = url;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`   ✅ Updated bos.config.json: app.api.production`);
  } catch (err) {
    console.error("   ❌ Failed to update bos.config.json:", err.message);
  }
}

const baseConfig = {
  externals: [/^@libsql\/.*/],
  plugins: [new EveryPluginDevServer({ dts: false }), new FixMfDataUriPlugin()],
  infrastructureLogging: {
    level: "error",
  },
  stats: "errors-warnings",
};

export default shouldDeploy
  ? withZephyr({
      hooks: {
        onDeployComplete: (info) => {
          console.log("🚀 API Deployed:", info.url);
          updateHostConfig(pkg.name, `${info.url}/mf-manifest.json`);
        },
      },
    })(baseConfig)
  : baseConfig;
