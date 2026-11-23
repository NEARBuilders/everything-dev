import "dotenv/config";
import type { PluginConfigInput } from "every-plugin";
import packageJson from "./package.json" with { type: "json" };
import type Plugin from "./src/index";

export default {
  pluginId: packageJson.name,
  port: Number(process.env.PORT) || 3013,
  config: {
    variables: {
      baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
      model: process.env.AI_MODEL || "gpt-4o-mini",
    },
    secrets: {
      AI_API_KEY: process.env.AI_API_KEY || "sk-dev-placeholder",
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
