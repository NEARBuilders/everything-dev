import { API, App, Plugin, UI } from "everything-dev/descriptor";

/**
 * The everything.dev runtime — the framework's own app. This repo hosts it
 * until the fork merges upstream; citynode.app extends it (bos.citynode.app.ts).
 * Authored fields only — production URLs and integrity are pipeline state.
 * Workspace secret lists are declared by the deploying runtime (the child
 * overrides own its secret surface); the base declares composition.
 */
export default App({
  name: "everything.dev",
  account: "dev.everything.near",
  domain: "everything.dev",
  title: "everything.dev",
  description:
    "Open runtime for apps on NEAR, composed from published config and loaded through a shared host, UI, and API runtime.",
  staging: { domain: "dev.everything.dev" },
  repository: "https://github.com/nearbuilders/everything-dev",
  ci: { railway: { service: "app" } },
  cdn: { origin: "https://cdn.everything.dev" },
  host: { path: "host" },
  ui: UI({ path: "ui" }),
  api: API({ path: "api", variables: { gatewayDomains: "everything.dev,dev.everything.dev" } }),
  auth: Plugin("auth").path("plugins/auth", {
    name: "@everything-dev/auth-plugin",
    secrets: [
      "AUTH_DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "GITHUB_CLIENT_SECRET",
      "GOOGLE_CLIENT_SECRET",
      "FASTNEAR_API_KEY",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
      "RESEND_API_KEY",
      "NEAR_RELAYER_PRIVATE_KEY_MAINNET",
      "NEAR_RELAYER_PRIVATE_KEY_TESTNET",
    ],
  }),
  plugins: {
    registry: Plugin("registry").path("plugins/registry", {
      variables: { registryNamespace: "dev.everything.near" },
    }),
    template: Plugin("template").path("plugins/_template", {
      name: "@every-plugin/template",
      secrets: ["TEMPLATE_DATABASE_URL"],
    }),
    ai: Plugin("ai").path("plugins/ai", {
      name: "@everything-dev/ai-plugin",
      variables: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
      },
      secrets: ["AI_API_KEY"],
      ui: { name: "ai-ui", path: "plugins/ai/ui" },
    }),
  },
});
