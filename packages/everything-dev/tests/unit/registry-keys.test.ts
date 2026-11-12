import { describe, expect, it } from "vitest";
import {
  networkIdForAccount,
  type RegistryKey,
  registryBaseUrlForNetwork,
  registryClientShape,
  registryNamespaceForNetwork,
} from "../../src/services/registry/client";
import {
  keyPathOf,
  parseRuntimeRef,
  RegistryRefError,
  runtimeRefOf,
} from "../../src/services/registry/keys";

/**
 * Golden wire-key tests (sprint registry-primitive, ticket 01): every
 * registry read and write derives its FastKV key from `keyPathOf`, and every
 * runtime ref parses through `parseRuntimeRef` — these tests pin the wire
 * forms and encode the invariant the whole sprint exists to make provable:
 *
 *   the account segment is the signing namespace (dev.everything.near);
 *   the gateway segment is the runtime's domain (everything.dev);
 *   no derivation may confuse the two — the gateway is never an account.
 *
 * The gateway-incident form (bos://dev.everything.near/dev.everything.dev —
 * an abandoned dead-end runtime) is asserted as a VALID ref (it parses) but
 * its keys are distinct from the root's: reading the root's manifest never
 * touches the dead end's namespace.
 */

const ROOT_REF = "bos://dev.everything.near/everything.dev";

describe("parseRuntimeRef / runtimeRefOf", () => {
  it("parses the production root into account and gateway", () => {
    expect(parseRuntimeRef(ROOT_REF)).toEqual({
      accountId: "dev.everything.near",
      gatewayId: "everything.dev",
      path: [],
    });
  });

  it("keeps sub-path segments for nested config keys and strips fragments", () => {
    expect(parseRuntimeRef("bos://a.near/g.dev/team/app#anchor")).toEqual({
      accountId: "a.near",
      gatewayId: "g.dev",
      path: ["team", "app"],
    });
  });

  it("round-trips through runtimeRefOf", () => {
    expect(runtimeRefOf({ accountId: "dev.everything.near", gatewayId: "everything.dev" })).toBe(
      ROOT_REF,
    );
  });

  it("rejects malformed refs loudly", () => {
    expect(() => parseRuntimeRef("https://a.near/g")).toThrow(RegistryRefError);
    expect(() => parseRuntimeRef("bos://only-account")).toThrow(RegistryRefError);
    expect(() => runtimeRefOf({ accountId: "", gatewayId: "g" })).toThrow(RegistryRefError);
  });
});

describe("keyPathOf — golden wire keys", () => {
  it.each([
    [
      { kind: "runtimeConfig", ref: ROOT_REF } as const,
      "apps/dev.everything.near/everything.dev/bos.config.json",
    ],
    [
      { kind: "runtimeConfig", ref: ROOT_REF, path: ["team", "app"] } as const,
      "apps/dev.everything.near/everything.dev/team/app/bos.config.json",
    ],
    [
      { kind: "manifest", ref: ROOT_REF } as const,
      "apps/dev.everything.near/everything.dev/manifest.json",
    ],
    [
      { kind: "version", ref: ROOT_REF, version: "2.0.0-rc.31" } as const,
      "apps/dev.everything.near/everything.dev/versions/2.0.0-rc.31.json",
    ],
    [
      { kind: "deployRecord", ref: ROOT_REF, ts: "2026-11-03T05-25-02" } as const,
      "apps/dev.everything.near/everything.dev/deploys/2026-11-03T05-25-02.json",
    ],
  ])("%s → %s", (key, expected) => {
    expect(keyPathOf(key)).toBe(expected);
  });

  it("the dead-end gateway's keys never collide with the root's", () => {
    const root = keyPathOf({ kind: "manifest", ref: ROOT_REF });
    const deadEnd = keyPathOf({
      kind: "manifest",
      ref: "bos://dev.everything.near/dev.everything.dev",
    });
    expect(root).toBe("apps/dev.everything.near/everything.dev/manifest.json");
    expect(deadEnd).toBe("apps/dev.everything.near/dev.everything.dev/manifest.json");
    expect(root).not.toBe(deadEnd);
  });

  it("rejects multi-segment versions and deploy timestamps", () => {
    expect(() => keyPathOf({ kind: "version", ref: ROOT_REF, version: "rc.30/extra" })).toThrow(
      RegistryRefError,
    );
    expect(() => keyPathOf({ kind: "deployRecord", ref: ROOT_REF, ts: "a/b" })).toThrow(
      RegistryRefError,
    );
  });
});

describe("registry URL derivation — the one function", () => {
  it("derives the mainnet base and namespace from the account suffix", () => {
    expect(networkIdForAccount("dev.everything.near")).toBe("mainnet");
    expect(registryBaseUrlForNetwork("mainnet")).toBe("https://kv.main.fastnear.com");
    expect(registryNamespaceForNetwork("mainnet")).toBe("dev.everything.near");
  });

  it("derives testnet for .testnet accounts", () => {
    expect(networkIdForAccount("dev.allthethings.testnet")).toBe("testnet");
    expect(registryBaseUrlForNetwork("testnet")).toBe("https://kv.test.fastnear.com");
    expect(registryNamespaceForNetwork("testnet")).toBe("dev.allthethings.testnet");
  });

  it("a registry override replaces the namespace at both networks", () => {
    expect(registryNamespaceForNetwork("mainnet", "custom.near")).toBe("custom.near");
    expect(registryNamespaceForNetwork("testnet", "custom.testnet")).toBe("custom.testnet");
  });
});

describe("RegistryClient — read semantics", () => {
  const manifestKey: RegistryKey = { kind: "manifest", ref: ROOT_REF };
  const jsonResponse = (body: unknown, status = 200): Response =>
    ({
      ok: status < 400,
      status,
      json: async () => body,
    }) as unknown as Response;

  const fetchServing = (value: unknown) => async () =>
    jsonResponse({ entries: [{ value, key: "apps/x" }] });

  it("reads an entry and parses string-encoded values", async () => {
    const value = await registryClientShape.read(manifestKey, {
      fetchImpl: fetchServing(JSON.stringify({ frameworkVersion: "2.0.0-rc.31" })),
    });
    expect(value).toEqual({ frameworkVersion: "2.0.0-rc.31" });
  });

  it("absent (empty entries) → RegistryError kind absent", async () => {
    const outcome = registryClientShape
      .read(manifestKey, {
        fetchImpl: fetchServing(undefined),
      })
      .catch((error: unknown) => error);
    await expect(outcome).resolves.toMatchObject({
      _tag: "RegistryError",
      kind: "absent",
      key: "apps/dev.everything.near/everything.dev/manifest.json",
    });
  });

  it("unreachable (HTTP 500) → RegistryError kind unreachable", async () => {
    const outcome = registryClientShape
      .read(manifestKey, { fetchImpl: async () => jsonResponse({}, 500) })
      .catch((error: unknown) => error);
    await expect(outcome).resolves.toMatchObject({ _tag: "RegistryError", kind: "unreachable" });
  });

  it("readOrNull collapses absent to null but rethrows unreachable", async () => {
    await expect(
      registryClientShape.readOrNull(manifestKey, { fetchImpl: fetchServing(undefined) }),
    ).resolves.toBeNull();
    await expect(
      registryClientShape.readOrNull(manifestKey, { fetchImpl: async () => jsonResponse({}, 503) }),
    ).rejects.toMatchObject({ _tag: "RegistryError", kind: "unreachable" });
  });

  it("the read URL encodes the full key as one path segment", async () => {
    let seen: string | undefined;
    await registryClientShape.read(manifestKey, {
      fetchImpl: async (input) => {
        seen = String(input);
        return jsonResponse({ entries: [{ value: { ok: true } }] });
      },
    });
    expect(seen).toBe(
      "https://kv.main.fastnear.com/v0/latest/dev.everything.near/dev.everything.near/" +
        "apps%2Fdev.everything.near%2Feverything.dev%2Fmanifest.json".replace(/\s/g, ""),
    );
  });
});
