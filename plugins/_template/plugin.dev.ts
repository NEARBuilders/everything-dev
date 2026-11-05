import "dotenv/config";
import type { PluginConfigInput } from "every-plugin";
import { pgliteDefaultUrlForSlug, workspaceIdentityFromModuleUrl } from "everything-dev/db";
import type Plugin from "./src/index";

// Same derivation as src/index.ts — a renamed template copy gets its own dir.
const TEMPLATE_PGLITE_DEFAULT = pgliteDefaultUrlForSlug(
  workspaceIdentityFromModuleUrl(import.meta.url).slug,
);

export default {
  port: Number(process.env.PORT) || 3010,
  config: {
    variables: {
      baseUrl: "https://api.example.com",
      timeout: 10000,
    },
    secrets: {
      TEMPLATE_API_KEY: process.env.TEMPLATE_API_KEY || "dev-key-12345",
      TEMPLATE_DATABASE_URL: process.env.TEMPLATE_DATABASE_URL || TEMPLATE_PGLITE_DEFAULT,
    },
  } satisfies PluginConfigInput<typeof Plugin>,
};
