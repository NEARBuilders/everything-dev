import { App, Plugin } from "everything-dev/descriptor";

export default App({
  name: "child.test",
  extends: "./base.json",
  account: "child.near",
  domain: "child.near",
  title: "Child",
  auth: Plugin("auth").path("plugins/auth", {
    name: "@everything-dev/auth-plugin",
    secrets: ["BETTER_AUTH_SECRET"],
  }),
});
