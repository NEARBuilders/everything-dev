import { describe, expect, it } from "vitest";
import {
  deploymentDigest,
  pointerDigest,
  remoteDigests,
} from "../../src/services/registry/fingerprint";
import type { BosConfig, RuntimeConfig } from "../../src/types";

/**
 * The identity-contract tests (ADR 0046 ticket 04): the two composition
 * digests derive in one module, and their relation holds by construction —
 *
 *   pointer stable + entries stable  ⇒  deployment stable
 *   entry-only movement              ⇒  deployment moves, pointer does not
 *   pointer-only movement            ⇒  deployment moves (adopt sensitivity)
 *
 * The third property is the seam closure's teeth: a republish that changes
 * only the files map (identical entry bytes) must move the deployment digest,
 * or the host would keep verifying lazy chunks against a stale pin until
 * restart. The converse relation is deliberately not asserted — deployment
 * stability is a serving-plane statement, never proof nothing was
 * republished.
 */

const pointer = (): BosConfig =>
  ({
    account: "a.test",
    gateway: "gw.test",
    app: {
      ui: {
        name: "ui",
        production: "https://cdn.test/ui",
        digest: { manifest: "versions/ui-v1.json", integrity: "sha384-ui-manifest" },
      },
      api: {
        name: "api",
        production: "https://cdn.test/api",
        digest: { manifest: "versions/api-v1.json", integrity: "sha384-api-manifest" },
      },
    },
    plugins: {
      votes: {
        name: "votes",
        production: "https://cdn.test/votes",
        digest: { manifest: "versions/votes-v1.json", integrity: "sha384-votes-manifest" },
        ui: {
          production: "https://cdn.test/votes-ui",
          digest: { manifest: "versions/votes-ui-v1.json", integrity: "sha384-votes-ui-manifest" },
        },
      },
    },
  }) as never;

/** The resolved shape resolution stamps: pin coordinates on every slot (the
 * pointer inputs) plus the resolved entry coordinates (what is served). */
const resolved = (): RuntimeConfig =>
  ({
    env: "production",
    account: "a.test",
    networkId: "mainnet",
    ui: {
      name: "ui",
      url: "https://cdn.test/ui",
      entry: "https://cdn.test/ui/mf-manifest.json",
      source: "remote",
      integrity: "sha384-ui-entry",
      entryUrl: "https://cdn.test/ui/versions/dir-ui/remoteEntry.js",
      ssrIntegrity: "sha384-ui-ssr",
      digest: { manifest: "versions/ui-v1.json", integrity: "sha384-ui-manifest" },
    },
    api: {
      name: "api",
      url: "https://cdn.test/api",
      entry: "https://cdn.test/api/mf-manifest.json",
      source: "remote",
      integrity: "sha384-api-entry",
      entryUrl: "https://cdn.test/api/versions/dir-api/remoteEntry.js",
      digest: { manifest: "versions/api-v1.json", integrity: "sha384-api-manifest" },
    },
    plugins: {
      votes: {
        name: "votes",
        url: "https://cdn.test/votes",
        entry: "https://cdn.test/votes/mf-manifest.json",
        source: "remote",
        integrity: "sha384-votes-entry",
        entryUrl: "https://cdn.test/votes/versions/dir-votes/remoteEntry.js",
        digest: { manifest: "versions/votes-v1.json", integrity: "sha384-votes-manifest" },
        ui: {
          name: "votes-ui",
          url: "https://cdn.test/votes-ui",
          entry: "https://cdn.test/votes-ui/mf-manifest.json",
          source: "remote",
          integrity: "sha384-votes-ui-entry",
          entryUrl: "https://cdn.test/votes-ui/versions/dir-votes-ui/remoteEntry.js",
          digest: {
            manifest: "versions/votes-ui-v1.json",
            integrity: "sha384-votes-ui-manifest",
          },
        },
      },
    },
  }) as never;

describe("pointerDigest — the composition identity", () => {
  it("is equal for pointer-equal configs and blind to non-pin metadata", () => {
    const a = pointer();
    const b = pointer();
    (b as { title?: string }).title = "a different title";
    (b as { app: { ui: { publicUrl?: string } } }).app.ui.publicUrl = "https://public.test/ui";
    expect(pointerDigest(a)).toBe(pointerDigest(b));
  });

  it("moves when a pin coordinate moves — including a plugin-ui slot", () => {
    const moved = pointer();
    (
      moved as { plugins: { votes: { ui: { digest: { integrity: string } } } } }
    ).plugins.votes.ui.digest.integrity = "sha384-votes-ui-manifest-2";
    expect(pointerDigest(moved)).not.toBe(pointerDigest(pointer()));
  });

  it("reads per-remote manifest filenames for display", () => {
    const digests = remoteDigests(pointer());
    expect(digests).toEqual({
      "app.ui": "versions/ui-v1.json",
      "app.api": "versions/api-v1.json",
      "plugins.votes": "versions/votes-v1.json",
      "plugins.votes.ui": "versions/votes-ui-v1.json",
    });
  });
});

describe("deploymentDigest — the serving-generation identity", () => {
  it("is stable for pointer-equal configs with equal entries — metadata does not move it", () => {
    const a = resolved();
    const b = resolved();
    (b as { title?: string }).title = "a different title";
    (b as { plugins: { votes: { variables?: Record<string, string> } } }).plugins.votes.variables =
      { env: "staging" };
    expect(deploymentDigest(a)).toBe(deploymentDigest(b));
    expect(deploymentDigest(a)).toBe(deploymentDigest(resolved()));
  });

  it("moves on an entry-only change — while the pointer stays put", () => {
    const before = resolved();
    const after = resolved();
    (after as { ui: { entryUrl: string; integrity: string } }).ui.entryUrl =
      "https://cdn.test/ui/versions/dir-ui-2/remoteEntry.js";
    (after as { ui: { integrity: string } }).ui.integrity = "sha384-ui-entry-2";
    expect(deploymentDigest(after)).not.toBe(deploymentDigest(before));
    expect(pointerDigest(pointer())).toBe(pointerDigest(pointer()));
  });

  it("moves on a pointer-only change — the files-map republish adopt sensitivity", () => {
    const before = resolved();
    const after = resolved();
    (after as { ui: { digest: { integrity: string } } }).ui.digest.integrity =
      "sha384-ui-manifest-2";
    const movedPointer = pointer();
    (movedPointer as { app: { ui: { digest: { integrity: string } } } }).app.ui.digest.integrity =
      "sha384-ui-manifest-2";
    expect(deploymentDigest(after)).not.toBe(deploymentDigest(before));
    expect(pointerDigest(movedPointer)).not.toBe(pointerDigest(pointer()));
  });

  it("is stable for local dev slots — no pins, no resolution churn", () => {
    const dev = (): RuntimeConfig =>
      ({
        env: "development",
        account: "a.test",
        networkId: "testnet",
        ui: {
          name: "ui",
          url: "http://localhost:3003",
          entry: "http://localhost:3003/mf-manifest.json",
          source: "local",
          localPath: "/workspaces/ui",
        },
        api: {
          name: "api",
          url: "http://localhost:3001",
          entry: "http://localhost:3001/mf-manifest.json",
          source: "local",
          localPath: "/workspaces/api",
        },
      }) as never;
    expect(deploymentDigest(dev())).toBe(deploymentDigest(dev()));
  });
});
