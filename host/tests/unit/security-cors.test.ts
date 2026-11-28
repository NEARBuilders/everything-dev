import { describe, expect, it } from "vitest";
import { resolveCorsOrigin } from "../../src/middleware/security";
import type { TenantBinding } from "../../src/services/binding-resolver";

function activeBinding(hostname: string): TenantBinding {
  return {
    hostname,
    tenantId: "tenant-1",
    accountId: "account.near",
    allowUiOverrides: true,
    allowBackendOverrides: false,
    allowSsr: false,
    status: "active",
  };
}

const noBinding = () => Promise.resolve(null);

describe("resolveCorsOrigin", () => {
  it("returns * when no origin header is present", async () => {
    await expect(
      resolveCorsOrigin(undefined, {
        allowedOrigins: [],
        isDev: false,
        gatewayId: "everything.dev",
        requestHost: "api.everything.dev",
        bindingLookup: noBinding,
      }),
    ).resolves.toBe("*");
    await expect(
      resolveCorsOrigin("", {
        allowedOrigins: [],
        isDev: false,
        gatewayId: "everything.dev",
        requestHost: "api.everything.dev",
        bindingLookup: noBinding,
      }),
    ).resolves.toBe("*");
  });

  it("reflects an origin listed exactly in allowedOrigins", async () => {
    await expect(
      resolveCorsOrigin("https://app.example.com", {
        allowedOrigins: ["https://app.example.com"],
        isDev: false,
        gatewayId: "everything.dev",
        requestHost: "api.everything.dev",
        bindingLookup: noBinding,
      }),
    ).resolves.toBe("https://app.example.com");
  });

  it("reflects an origin matched by a glob entry in allowedOrigins", async () => {
    await expect(
      resolveCorsOrigin("https://tenant.example.com", {
        allowedOrigins: ["https://*.example.com"],
        isDev: false,
        gatewayId: "everything.dev",
        requestHost: "api.everything.dev",
        bindingLookup: noBinding,
      }),
    ).resolves.toBe("https://tenant.example.com");
  });

  it("rejects an arbitrary https origin that is not trusted (regression: the https wildcard)", async () => {
    await expect(
      resolveCorsOrigin("https://attacker-probe.example", {
        allowedOrigins: [],
        isDev: false,
        gatewayId: "everything.dev",
        requestHost: "api.everything.dev",
        bindingLookup: noBinding,
      }),
    ).resolves.toBeNull();
  });

  it("allows the gateway itself", async () => {
    await expect(
      resolveCorsOrigin("https://everything.dev", {
        allowedOrigins: [],
        isDev: false,
        gatewayId: "everything.dev",
        requestHost: "api.everything.dev",
        bindingLookup: noBinding,
      }),
    ).resolves.toBe("https://everything.dev");
  });

  it("allows a gateway subdomain", async () => {
    await expect(
      resolveCorsOrigin("https://tenant.everything.dev", {
        allowedOrigins: [],
        isDev: false,
        gatewayId: "everything.dev",
        requestHost: "api.everything.dev",
        bindingLookup: noBinding,
      }),
    ).resolves.toBe("https://tenant.everything.dev");
  });

  it("allows an origin backed by an active tenant binding", async () => {
    await expect(
      resolveCorsOrigin("https://custom-tenant.dev", {
        allowedOrigins: [],
        isDev: false,
        gatewayId: "everything.dev",
        requestHost: "api.everything.dev",
        bindingLookup: (hostname) =>
          hostname === "custom-tenant.dev" ? Promise.resolve(activeBinding(hostname)) : noBinding(),
      }),
    ).resolves.toBe("https://custom-tenant.dev");
  });

  it("rejects origins whose binding is not active", async () => {
    for (const status of ["pending", "suspended"] as const) {
      await expect(
        resolveCorsOrigin("https://custom-tenant.dev", {
          allowedOrigins: [],
          isDev: false,
          gatewayId: "everything.dev",
          requestHost: "api.everything.dev",
          bindingLookup: () => Promise.resolve({ ...activeBinding("custom-tenant.dev"), status }),
        }),
      ).resolves.toBeNull();
    }
  });

  it("allows http origins only in development", async () => {
    const devCtx = {
      allowedOrigins: [],
      isDev: true,
      gatewayId: "everything.dev",
      requestHost: "api.everything.dev",
      bindingLookup: noBinding,
    };
    await expect(resolveCorsOrigin("http://localhost:3003", devCtx)).resolves.toBe(
      "http://localhost:3003",
    );
    await expect(
      resolveCorsOrigin("http://localhost:3003", { ...devCtx, isDev: false }),
    ).resolves.toBeNull();
  });

  it("allows a same-host origin without any other trust signal", async () => {
    await expect(
      resolveCorsOrigin("http://api.everything.dev:3001", {
        allowedOrigins: [],
        isDev: false,
        gatewayId: "example-unrelated.dev",
        requestHost: "api.everything.dev:3001",
        bindingLookup: noBinding,
      }),
    ).resolves.toBe("http://api.everything.dev:3001");
  });

  it("treats a bindingLookup failure as no binding (fail closed)", async () => {
    await expect(
      resolveCorsOrigin("https://custom-tenant.dev", {
        allowedOrigins: [],
        isDev: false,
        gatewayId: "everything.dev",
        requestHost: "api.everything.dev",
        bindingLookup: () => Promise.reject(new Error("bindings unavailable")),
      }),
    ).resolves.toBeNull();
  });
});
