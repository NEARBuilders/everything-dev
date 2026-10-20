/**
 * FRAMEWORK-OWNED — reconciled from the parent template by `bos sync` / `bos upgrade`.
 * Local edits are allowed: on the next sync the template version wins and your copy
 * is backed up under `.bos/sync-backup/`. To make a change permanent, file an issue:
 * https://github.com/NEARBuilders/everything-dev/issues
 */
import Plugin from "@/index";
import packageJson from "../package.json" with { type: "json" };

declare module "every-plugin" {
  interface RegisteredPlugins {
    [packageJson.name]: typeof Plugin;
  }
}
