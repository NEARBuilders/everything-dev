import "dotenv/config";
import type { PluginConfigInput } from "every-plugin";
import type Plugin from "./src/index";

export default {
  port: Number(process.env.PORT) || 3016,
  config: {
    variables: {
      apiBaseUrl: process.env.AGENT_CONNECT_API_BASE_URL || undefined,
      apiTimeoutMs: process.env.AGENT_CONNECT_API_TIMEOUT_MS
        ? Number(process.env.AGENT_CONNECT_API_TIMEOUT_MS)
        : undefined,
    },
    secrets: {
      NEAR_INTENTS_AGENT_API_KEY: process.env.NEAR_INTENTS_AGENT_API_KEY || `naa_${"a".repeat(43)}`,
      AGENT_CONNECT_ENCRYPTION_KEY: process.env.AGENT_CONNECT_ENCRYPTION_KEY,
      AGENT_CONNECT_DATABASE_URL:
        process.env.AGENT_CONNECT_DATABASE_URL || "pglite:.bos/agent-connect/:memory:",
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
