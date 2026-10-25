import { describe, expect, it } from "vitest";

import { stripLocalDevelopmentTargets } from "../../src/services/resolution/merge";
import { BosConfigSchema } from "../../src/types";

/**
 * Regression for the 2026-10-25 root-runtime outage: every deploy since
 * #611/#584 (strip `local:` dev targets from published payloads) failed the
 * post-publish smoke with
 *   app.host.development — expected string, received undefined
 * because HostConfigSchema still required the stripped field. The canonicalized
 * payload must therefore round-trip the same schema every runtime boot runs
 * (resolvePublishedConfig → BosConfigSchema.parse, see the smoke's
 * "Failed to fetch config" gate).
 */

const resolvedConfig = {
  account: "dev.everything.near",
  domain: "everything.dev",
  title: "everything.dev",
  repository: "https://github.com/nearbuilders/everything-dev",
  ci: { railway: { service: "app" } },
  cdn: { origin: "https://cdn.everything.dev" },
  app: {
    host: {
      development: "local:host",
      production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/host/",
      integrity: "sha384-Vky0MKce",
      pin: { manifest: "versions/06256e721e1b0e70.json", integrity: "sha384-Vky0MKce" },
    },
    ui: {
      development: "local:ui",
      production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/ui/",
      pin: { manifest: "versions/79920069a180af1d.json", integrity: "sha384-n9HmaBE8" },
    },
    api: {
      development: "local:api",
      production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/api/",
      variables: { gatewayDomains: "everything.dev,dev.everything.dev" },
      secrets: ["API_DATABASE_URL", "BETTER_AUTH_SECRET"],
      pin: { manifest: "versions/bf70b2bbad772fa3.json", integrity: "sha384-T+g03rDE" },
    },
    auth: {
      name: "@everything-dev/auth-plugin",
      development: "local:plugins/auth",
      production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/auth/",
      variables: {
        siwn: { recipients: { mainnet: "dev.everything.near" } },
      },
      secrets: ["AUTH_DATABASE_URL"],
      ui: {
        name: "_everything_dev_auth_plugin",
        development: "local:plugins/auth/ui",
        production:
          "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/auth-ui/",
        pin: { manifest: "versions/69fab2be8064da4b.json", integrity: "sha384-14fk6yR8" },
      },
      pin: { manifest: "versions/3a2b87c163e265a0.json", integrity: "sha384-0k+YJ4YM" },
    },
  },
  plugins: {
    registry: {
      name: "@everything-dev/registry-plugin",
      development: "local:plugins/registry",
      production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/registry/",
      variables: { registryNamespace: "dev.everything.near" },
      pin: { manifest: "versions/be30ab507a99a19a.json", integrity: "sha384-ioD5yc8O" },
    },
  },
} as const;

describe("canonicalized publish payload round-trips the publish schema (#611 x HostConfigSchema)", () => {
  it("the canonicalized payload parses — the stripped app.host.development cannot fail the boot gate", () => {
    const canonical = stripLocalDevelopmentTargets(structuredClone(resolvedConfig)) as unknown;

    expect(
      (canonical as { app: { host: { development?: string } } }).app.host.development,
    ).toBeUndefined();

    const parsed = BosConfigSchema.parse(canonical);
    expect(parsed.app.host.production).toContain("everything.dev/host/");
    expect(parsed.app.host.development).toBeUndefined();
  });

  it("the pre-canonicalization shape (local: refs present) stays schema-valid — old snapshots must never trip the preflight guard", () => {
    const parsed = BosConfigSchema.parse(structuredClone(resolvedConfig));
    expect(parsed.app.host.development).toBe("local:host");
    expect(parsed.plugins.registry).toHaveProperty("production");
  });

  it("an auth-less runtime (published children) parses too", () => {
    const clone = structuredClone(resolvedConfig) as Record<string, unknown>;
    const app = clone.app as Record<string, unknown>;
    delete app.auth;
    expect(() => BosConfigSchema.parse(clone)).not.toThrow();
  });
});
