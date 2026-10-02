import "dotenv/config";
import type { PluginConfigInput } from "every-plugin";
import packageJson from "./package.json" with { type: "json" };
import type Plugin from "./src/index";

export default {
  pluginId: packageJson.name,
  port: Number(process.env.PORT) || 3014,
  config: {
    variables: {},
    secrets: {
      VOTES_DATABASE_URL: process.env.VOTES_DATABASE_URL || "pglite:.bos/votes/:memory:",
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
