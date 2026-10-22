import { Context, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DatabaseTag } from "@/db/layer";
import { SecretsStoreError, buildSecretsStore, isReservedSecretName, isValidSecretName } from "@/lib/secrets-store";
import { authedContext, getPluginClient, getTestEffectContext } from "./setup";
import { devAuthSecret } from "../plugin.dev";

describe("secrets routes", () => {
  it("refuses unauthenticated calls", async () => {
    const client = await getPluginClient();
    await expect(
      client.secrets.set({ account: "anon.near", gateway: "anon.dev", name: "AI_API_KEY", value: "v" }),
    ).rejects.toThrow();
  });

  it("stores a secret, never echoes values, reconciles against declared names", async () => {
    const client = await getPluginClient(authedContext("operator-1"));
    const account = "app1.near";
    const gateway = "app1.dev";

    const stored = await client.secrets.set({
      account,
      gateway,
      name: "AI_API_KEY",
      value: "sk-super-secret-value",
    });
    expect(stored).toEqual({ name: "AI_API_KEY" });

    const { secrets, missing } = await client.secrets.list({
      account,
      gateway,
      declared: ["AI_API_KEY", "GITHUB_CLIENT_SECRET"],
    });
    expect(secrets).toEqual([
      { name: "AI_API_KEY", state: "set" },
      { name: "GITHUB_CLIENT_SECRET", state: "missing" },
    ]);
    expect(missing).toEqual(["GITHUB_CLIENT_SECRET"]);
    expect(JSON.stringify(secrets)).not.toContain("sk-super-secret-value");
  });

  it("marks rows the runtime no longer declares as undeclared", async () => {
    const client = await getPluginClient(authedContext());
    const account = "app2.near";
    const gateway = "app2.dev";

    await client.secrets.set({ account, gateway, name: "OLD_KEY", value: "v" });
    const { secrets, missing } = await client.secrets.list({
      account,
      gateway,
      declared: ["NEW_KEY"],
    });
    expect(secrets).toEqual([
      { name: "NEW_KEY", state: "missing" },
      { name: "OLD_KEY", state: "undeclared" },
    ]);
    expect(missing).toEqual(["NEW_KEY"]);
  });

  it("refuses reserved and malformed names", async () => {
    const client = await getPluginClient(authedContext());
    const base = { account: "app3.near", gateway: "app3.dev" };

    await expect(
      client.secrets.set({ ...base, name: "BOS_ACCOUNT", value: "x" }),
    ).rejects.toThrow(/reserved/i);
    await expect(client.secrets.set({ ...base, name: "PORT", value: "x" })).rejects.toThrow(
      /reserved/i,
    );
  });

  it("rotates a value and removes it", async () => {
    const client = await getPluginClient(authedContext());
    const account = "app4.near";
    const gateway = "app4.dev";

    await client.secrets.set({ account, gateway, name: "DB_PASS", value: "first" });
    await client.secrets.set({ account, gateway, name: "DB_PASS", value: "second" });
    const removed = await client.secrets.remove({ account, gateway, name: "DB_PASS" });
    expect(removed).toEqual({ removed: true });

    const { secrets } = await client.secrets.list({ account, gateway });
    expect(secrets).toEqual([]);

    const again = await client.secrets.remove({ account, gateway, name: "DB_PASS" });
    expect(again).toEqual({ removed: false });
  });
});

describe("secrets store service", () => {
  it("resolve unseals values; a rotated root secret fails loudly", async () => {
    const client = await getPluginClient(authedContext());
    const account = "app5.near";
    const gateway = "app5.dev";

    await client.secrets.set({
      account,
      gateway,
      name: "STRIPE_KEY",
      value: "rk-live-1234",
    });

    const context = getTestEffectContext();
    expect(context).toBeTruthy();
    const db = Context.get(context as never, DatabaseTag);

    const sameRoot = buildSecretsStore(db, devAuthSecret);
    const unsealed = await Effect.runPromise(sameRoot.resolve({ account, gateway }));
    expect(unsealed.STRIPE_KEY).toBe("rk-live-1234");

    const rotated = buildSecretsStore(db, "a-rotated-root-secret");
    const failure = await Effect.runPromise(rotated.resolve({ account, gateway })).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SecretsStoreError);
    expect((failure as SecretsStoreError).message).toContain("Re-set it");
  });
});

describe("secret name rules", () => {
  it("reserves BOS_* and PORT, requires UPPER_SNAKE_CASE", () => {
    expect(isReservedSecretName("BOS_ACCOUNT")).toBe(true);
    expect(isReservedSecretName("BOS_GATEWAY")).toBe(true);
    expect(isReservedSecretName("PORT")).toBe(true);
    expect(isReservedSecretName("AI_API_KEY")).toBe(false);
    expect(isValidSecretName("AI_API_KEY")).toBe(true);
    expect(isValidSecretName("lowercase")).toBe(false);
    expect(isValidSecretName("BOS_THING")).toBe(false);
  });
});
