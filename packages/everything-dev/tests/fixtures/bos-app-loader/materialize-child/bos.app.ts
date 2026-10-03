import { App, Plugin } from "everything-dev/descriptor";

export const base = App({
  name: "base.test",
  account: "base.near",
  domain: "base.near",
  title: "Base",
  api: { path: "api", variables: { platformAccount: "base.near" } },
});

export default App({
  name: "child.test",
  extends: base,
  account: "child.near",
  domain: "child.near",
  auth: Plugin("auth").path("plugins/auth", {
    name: "@everything-dev/auth-plugin",
  }),
});
