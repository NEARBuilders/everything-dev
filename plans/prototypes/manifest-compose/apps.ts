import { App, Plugin, type AppInput } from "@manifest-compose/shared";

/**
 * The authored app (plan 028's contract, prototype slice): pure data, the
 * boot input — always LOCAL refs (dev authoring shape). Deployment resolves
 * them to URLs via the deploy map (the publish write-back stand-in);
 * `tenant` extends base — inheriting auth — and swaps the landing plugin
 * for its own workspace (deployed: its own remote, unique MF name).
 */
export const baseApp = App({
  name: "base",
  plugins: {
    auth: Plugin("auth").local("./remote-auth"),
    landing: Plugin("landing").local("./remote-landing"),
  },
});

export const tenantApp = App({
  name: "tenant",
  extends: "base",
  plugins: {
    landing: Plugin("landing").local("./remote-landing-tenant"),
  },
});

export const APPS: Record<string, AppInput> = { base: baseApp, tenant: tenantApp };
export type AppKey = keyof typeof APPS & string;
