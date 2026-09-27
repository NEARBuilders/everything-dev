import fs from "node:fs";
import path from "node:path";

import { findBosConfigPath } from "./compose";

export { findBosConfigPath };

function generatedRspackConfig(hasOverrides: boolean): string {
  return `import { createPluginBaseConfig } from "every-plugin/build/rspack";
${hasOverrides ? `import buildOverrides from "../build.config.ts";\n` : ""}
export default createPluginBaseConfig(${hasOverrides ? "buildOverrides" : "{}"});
`;
}

/**
 * Ensures the synthesized rspack config exists for workspaces that no longer
 * ship their own `rspack.config.js`. Returns the workspace-relative config
 * path to pass via `--config`, or `null` when the workspace has its own
 * `rspack.config.js` and bare `rspack build` should be used.
 */
export function ensureGeneratedRspackConfig(cwd: string = process.cwd()): string | null {
  if (fs.existsSync(path.join(cwd, "rspack.config.js"))) return null;

  const overridesPath = path.resolve(cwd, "build.config.ts");
  const hasOverrides = fs.existsSync(overridesPath);
  const generatedDir = path.join(cwd, ".every-plugin");
  const generatedConfig = path.join(generatedDir, "rspack.config.generated.mjs");
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(generatedConfig, generatedRspackConfig(hasOverrides));

  console.log(
    "[every-plugin] rspack.config.js not found — using the every-plugin build composition.",
  );
  return path.join(".every-plugin", "rspack.config.generated.mjs");
}
