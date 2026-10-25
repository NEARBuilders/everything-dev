import { Effect, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nearAccount } from "../../src/db/schema";
import type { PluginServices } from "../../src/service-types";
import { buildApiKeysService } from "../../src/services/api-keys";
import {
  createTestApiKey,
  createTestHandlers,
  createTestOrg,
  createTestServices,
  createTestUser,
} from "../helpers";

let services: Awaited<ReturnType<typeof createTestServices>>;

beforeAll(async () => {
  services = await createTestServices();
}, 30000);

afterAll(async () => {
  await services.driver.close();
}, 30000);

async function linkTestNearAccount(
  svc: PluginServices,
  userId: string,
  accountId: string,
): Promise<void> {
  await svc.db.insert(nearAccount).values({
    id: `na-${crypto.randomUUID()}`,
    userId,
    accountId,
    network: "mainnet",
    publicKey: "ed25519:test-public-key",
    isPrimary: true,
    createdAt: new Date(),
  });
}

describe("API key handlers", () => {
  describe("createApiKey", () => {
    it("creates a user API key", async () => {
      const user = await createTestUser(services.services);
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.createApiKey({
        input: { name: "My User Key" },
        context: { reqHeaders: user.reqHeaders },
      });

      expect(result.key).toBeDefined();
      expect(result.key).toMatch(/^api_/);
      expect(result.name).toBe("My User Key");
    });

    it("creates an org API key when organizationId is provided", async () => {
      const user = await createTestUser(services.services);
      const org = await createTestOrg(services.services, user.userId);
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.createApiKey({
        input: { name: "My Org Key", organizationId: org.id },
        context: { reqHeaders: user.reqHeaders },
      });

      expect(result.key).toBeDefined();
      expect(result.key).toMatch(/^org_/);
    });
  });

  describe("verifyApiKey", () => {
    it("verifies a valid user key with explicit configId", async () => {
      const user = await createTestUser(services.services);
      const apiKey = await createTestApiKey(services.services, { userId: user.userId });
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.verifyApiKey({
        input: { key: apiKey.key, configId: "user-keys" },
        context: { reqHeaders: {} },
      });

      expect(result.valid).toBe(true);
      expect(result.key).not.toBeNull();
      expect(result.key?.configId).toBe("user-keys");
    });

    it("verifies a valid org key with explicit configId", async () => {
      const user = await createTestUser(services.services);
      const org = await createTestOrg(services.services, user.userId);
      const apiKey = await createTestApiKey(services.services, {
        userId: user.userId,
        organizationId: org.id,
      });
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.verifyApiKey({
        input: { key: apiKey.key, configId: "org-keys" },
        context: { reqHeaders: {} },
      });

      expect(result.valid).toBe(true);
      expect(result.key).not.toBeNull();
      expect(result.key?.configId).toBe("org-keys");
    });

    it("finds valid key via configId fallback loop", async () => {
      const user = await createTestUser(services.services);
      const apiKey = await createTestApiKey(services.services, { userId: user.userId });
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.verifyApiKey({
        input: { key: apiKey.key },
        context: { reqHeaders: {} },
      });

      expect(result.valid).toBe(true);
    });

    it("finds org key via configId fallback loop", async () => {
      const user = await createTestUser(services.services);
      const org = await createTestOrg(services.services, user.userId);
      const apiKey = await createTestApiKey(services.services, {
        userId: user.userId,
        organizationId: org.id,
      });
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.verifyApiKey({
        input: { key: apiKey.key },
        context: { reqHeaders: {} },
      });

      expect(result.valid).toBe(true);
    });

    it("returns invalid for non-existent key", async () => {
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.verifyApiKey({
        input: { key: "api_nonexistent" },
        context: { reqHeaders: {} },
      });

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe("KEY_NOT_FOUND");
    });

    it("returns invalid for wrong configId", async () => {
      const user = await createTestUser(services.services);
      const apiKey = await createTestApiKey(services.services, { userId: user.userId });
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.verifyApiKey({
        input: { key: apiKey.key, configId: "org-keys" },
        context: { reqHeaders: {} },
      });

      expect(result.valid).toBe(false);
    });

    it("distinguishes missing permissions from a missing key", async () => {
      const user = await createTestUser(services.services);
      const apiKey = await createTestApiKey(services.services, { userId: user.userId });
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.verifyApiKey({
        input: { key: apiKey.key, permissions: { bundles: ["write"] } },
        context: { reqHeaders: {} },
      });

      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe("KEY_MISSING_PERMISSIONS");
      expect(result.error?.message).toContain("bundles:write");
    });
  });

  describe("createDeployKey", () => {
    it("mints a deploy key that passes verifyApiKey with bundles:write", async () => {
      const user = await createTestUser(services.services);
      await linkTestNearAccount(services.services, user.userId, "deploy-mint.near");
      const handlers = createTestHandlers(services.services);

      const created = await handlers.apiKeys.createDeployKey({
        input: { account: "deploy-mint.near", gateway: "citynode.app" },
        context: { reqHeaders: user.reqHeaders },
      });
      expect(created.key).toMatch(/^api_/);

      const verified = await handlers.apiKeys.verifyApiKey({
        input: { key: created.key, permissions: { bundles: ["write"] } },
        context: { reqHeaders: {} },
      });
      expect(verified.valid).toBe(true);
      expect(verified.key).not.toBeNull();
      expect(verified.key?.configId).toBe("user-keys");
    });

    it("scopes the key to the requested account and gateway metadata", async () => {
      const user = await createTestUser(services.services);
      await linkTestNearAccount(services.services, user.userId, "citynode.near");
      const handlers = createTestHandlers(services.services);

      const created = await handlers.apiKeys.createDeployKey({
        input: { account: "citynode.near", gateway: "citynode.app" },
        context: { reqHeaders: user.reqHeaders },
      });

      const verified = await handlers.apiKeys.verifyApiKey({
        input: { key: created.key },
        context: { reqHeaders: {} },
      });
      expect(verified.valid).toBe(true);
      const metadata = verified.key?.metadata;
      expect(metadata).toMatchObject({ account: "citynode.near", gateway: "citynode.app" });
    });

    it("honors a custom name and expiry", async () => {
      const user = await createTestUser(services.services);
      await linkTestNearAccount(services.services, user.userId, "expiry-test.near");
      const handlers = createTestHandlers(services.services);

      const created = await handlers.apiKeys.createDeployKey({
        input: {
          account: "expiry-test.near",
          gateway: "citynode.app",
          name: "ci deploy key",
          expiresIn: 7 * 24 * 60 * 60,
        },
        context: { reqHeaders: user.reqHeaders },
      });
      expect(created.name).toBe("ci deploy key");
      expect(created.expiresAt).toBeDefined();
    });

    it("rejects accounts not linked to the signed-in user", async () => {
      const user = await createTestUser(services.services);
      const handlers = createTestHandlers(services.services);

      await expect(
        handlers.apiKeys.createDeployKey({
          input: { account: "not-linked.near", gateway: "citynode.app" },
          context: { reqHeaders: user.reqHeaders },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("listApiKeys", () => {
    it("lists API keys for a user", async () => {
      const user = await createTestUser(services.services);
      await createTestApiKey(services.services, { userId: user.userId, name: "Key 1" });
      await createTestApiKey(services.services, { userId: user.userId, name: "Key 2" });
      const handlers = createTestHandlers(services.services);

      const result = (await handlers.apiKeys.listApiKeys({
        input: {},
        context: { reqHeaders: user.reqHeaders },
      })) as Array<{ id: string; name: string | null }>;

      expect(result).toHaveLength(2);
      expect(result.map((k) => k.name)).toContain("Key 1");
      expect(result.map((k) => k.name)).toContain("Key 2");
    });
  });

  describe("updateApiKey", () => {
    it("updates an API key name", async () => {
      const user = await createTestUser(services.services);
      const apiKey = await createTestApiKey(services.services, {
        userId: user.userId,
        name: "Old Name",
      });
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.updateApiKey({
        input: { id: apiKey.id, name: "New Name" },
        context: { reqHeaders: user.reqHeaders },
      });

      expect(result.name).toBe("New Name");
    });

    it("disables an API key", async () => {
      const user = await createTestUser(services.services);
      const apiKey = await createTestApiKey(services.services, {
        userId: user.userId,
        name: "Disable Me",
      });
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.updateApiKey({
        input: { id: apiKey.id, enabled: false },
        context: { reqHeaders: user.reqHeaders },
      });

      expect(result.enabled).toBe(false);
    });
  });

  describe("ApiKeysService seam", () => {
    it("fails DeployKeyAccountNotLinked from the service when the account is not linked", async () => {
      const user = await createTestUser(services.services);
      const apiKeys = buildApiKeysService({
        auth: services.services.auth,
        db: services.services.db,
      });

      const exit = await Effect.runPromiseExit(
        apiKeys.createDeployKey(user.userId, {
          account: "not-linked.near",
          gateway: "citynode.app",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failures = exit.cause.reasons
          .map((r: unknown) => (r as { error?: { _tag?: string } } | undefined)?.error)
          .filter(Boolean) as Array<{ _tag?: string }>;
        expect(failures.some((f) => f._tag === "DeployKeyAccountNotLinked")).toBe(true);
      }
    });

    it("mints from the service when the account is linked", async () => {
      const user = await createTestUser(services.services);
      await linkTestNearAccount(services.services, user.userId, "service-mint.near");
      const apiKeys = buildApiKeysService({
        auth: services.services.auth,
        db: services.services.db,
      });

      const created = await Effect.runPromise(
        apiKeys.createDeployKey(user.userId, {
          account: "service-mint.near",
          gateway: "citynode.app",
        }),
      );

      expect(created.key).toMatch(/^api_/);
    });
  });

  describe("deleteApiKey", () => {
    it("deletes an API key", async () => {
      const user = await createTestUser(services.services);
      const apiKey = await createTestApiKey(services.services, {
        userId: user.userId,
        name: "Delete Me",
      });
      const handlers = createTestHandlers(services.services);

      const result = await handlers.apiKeys.deleteApiKey({
        input: { id: apiKey.id },
        context: { reqHeaders: user.reqHeaders },
      });

      expect(result.success).toBe(true);
    });
  });
});
