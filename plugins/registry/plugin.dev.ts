import "dotenv/config";
import type { PluginConfigInput } from "every-plugin";
import type Plugin from "./src/index";

export default {
  port: Number(process.env.PORT) || 3012,
  config: {
    variables: {
      registryNamespace: process.env.REGISTRY_NAMESPACE || undefined,
    },
    secrets: {
      REGISTRY_RELAY_ACCOUNT_ID: process.env.REGISTRY_RELAY_ACCOUNT_ID || undefined,
      REGISTRY_RELAY_PRIVATE_KEY: process.env.REGISTRY_RELAY_PRIVATE_KEY || undefined,
      REGISTRY_RELAY_NETWORK:
        (process.env.REGISTRY_RELAY_NETWORK as "mainnet" | "testnet" | undefined) || undefined,
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
