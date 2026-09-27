import { API, App, Plugin, UI } from "everything-dev/descriptor";
import everythingDev from "./bos.app";

/**
 * The citynode.app runtime — extends the everything.dev base by import
 * (same-monorepo composition; post-break-off this becomes
 * `extends: "bos://dev.everything.near/everything.dev"`).
 *
 * Today every workspace is overridden locally — citynode is a vendored fork.
 * Post-merge these local overrides shrink to the slots citynode actually
 * changes (the login-page ui override, citynode's plugins); the rest
 * inherits the published base.
 */
export default App({
  name: "citynode.app",
  extends: everythingDev,
  account: "v1.citynode.near",
  domain: "citynode.app",
  title: "City Nodes",
  description:
    "Decentralized city nodes on NEAR — each city is a tenant with its own validator pool you can stake to.",
  staging: { domain: "testnet.citynode.app", account: "v1.citynode.testnet" },
  repository: "https://github.com/NEARBuilders/citynode.app",
  ci: { railway: { service: "app" } },
  host: { path: "host", secrets: ["CORS_ORIGIN", "CSP_STRICT"] },
  ui: UI({ path: "ui" }),
  api: API({
    path: "api",
    variables: {
      platformAccount: "v1.citynode.near",
      gatewayDomains: "citynode.app,testnet.citynode.app",
    },
    secrets: ["API_DATABASE_URL", "LUMA_CALENDAR_API_KEYS"],
  }),
  auth: Plugin("auth").path("plugins/auth", {
    name: "@everything-dev/auth-plugin",
    ui: { name: "auth-ui", path: "plugins/auth/ui" },
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
    variables: {
      organizationMembershipLimit: 1000,
      deviceLink: { clientId: "citynode-web" },
      passkey: { rpID: "citynode.app", rpName: "City Nodes" },
      socialProviders: { github: {}, google: {} },
      siwn: {
        recipients: {
          mainnet: "v1.citynode.near",
          testnet: "v1.citynode.testnet",
        },
        relayer: {
          mainnet: {
            whitelistedContracts: ["v1.citynode.near", "dev.everything.near"],
            maxGasPerTransaction: "400000000000000",
            maxDepositPerTransaction: "0",
          },
          testnet: {
            whitelistedContracts: ["v1.citynode.testnet", "dev.allthethings.testnet"],
            maxGasPerTransaction: "400000000000000",
            maxDepositPerTransaction: "0",
          },
        },
        sessionGasKey: {
          mainnet: {
            receiverId: "dev.everything.near",
            methodNames: ["__fastdata_kv"],
          },
          testnet: {
            receiverId: "dev.allthethings.testnet",
            methodNames: ["__fastdata_kv"],
          },
        },
      },
    },
  }),
  plugins: {
    template: Plugin("template").path("plugins/_template", {
      secrets: ["TEMPLATE_DATABASE_URL"],
    }),
    apps: Plugin("apps").path("plugins/apps"),
    proposals: Plugin("proposals").path("plugins/proposals", {
      variables: { privatePluginIds: [] },
      secrets: ["PROPOSALS_DATABASE_URL"],
    }),
    votes: Plugin("votes").path("plugins/votes", { secrets: ["VOTES_DATABASE_URL"] }),
  },
});
