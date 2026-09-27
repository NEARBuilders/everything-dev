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
  host: { path: "host" },
  ui: UI({ path: "ui" }),
  api: API({ path: "api", variables: { gatewayDomains: "everything.dev,dev.everything.dev" } }),
  auth: Plugin("auth").path("plugins/auth", { name: "@everything-dev/auth-plugin" }),
  plugins: {
    apps: Plugin("apps").path("plugins/apps", {
      variables: { registryNamespace: "dev.everything.near" },
    }),
  },
});
