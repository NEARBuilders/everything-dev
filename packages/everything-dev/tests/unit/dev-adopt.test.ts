import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AdoptObservation,
  type AdoptState,
  advanceAdopt,
  type BackendDistFingerprint,
  createBackendFingerprintSampler,
  fingerprintContentOf,
  initialAdoptState,
} from "../../src/services/dev/adopt";

const fingerprint = (digest: string, mtimeMs = 100): BackendDistFingerprint => ({
  digest,
  newestMtimeMs: mtimeMs,
  files: new Map(),
});

const observation = (
  key: string,
  fingerprint: BackendDistFingerprint | null,
): AdoptObservation => ({
  key,
  fingerprint,
});

const advance = (
  state: AdoptState,
  observations: AdoptObservation[],
  now: number,
  settleMs = 1_000,
) => advanceAdopt(state, { now, settleMs, observations });

const step = (state: AdoptState, key: string, content: string, now: number) => {
  const next = advance(state, [observation(key, fingerprint(content))], now);
  return { state: next.state, moves: next.moves };
};

describe("advanceAdopt (the file-watcher state machine)", () => {
  it("the first observation records the boot generation — no move", () => {
    const { state, moves } = step(initialAdoptState, "plugin:votes", "gen-a", 0);
    expect(moves).toEqual([]);
    expect(state.served.get("plugin:votes")?.content).toBe("gen-a");
    expect(state.served.get("plugin:votes")?.generation).toBe(0);
  });

  it("a new content settles into one move after the settle window", () => {
    let state = initialAdoptState;
    let result = step(state, "plugin:votes", "gen-a", 0);
    state = result.state;

    result = step(state, "plugin:votes", "gen-b", 100);
    expect(result.moves).toEqual([]);
    state = result.state;

    result = step(state, "plugin:votes", "gen-b", 900);
    expect(result.moves).toEqual([]);
    state = result.state;

    result = step(state, "plugin:votes", "gen-b", 1_100);
    expect(result.moves).toEqual([{ key: "plugin:votes", content: "gen-b", generation: 1 }]);
  });

  it("content changing mid-settle restarts the settle clock", () => {
    let state = step(initialAdoptState, "plugin:votes", "gen-a", 0).state;

    let result = step(state, "plugin:votes", "gen-b", 100);
    state = result.state;
    result = step(state, "plugin:votes", "gen-c", 1_100);
    expect(result.moves).toEqual([]);
    state = result.state;

    result = step(state, "plugin:votes", "gen-c", 1_200);
    expect(result.moves).toEqual([]);
  });

  it("a revert to the served content clears the pending move", () => {
    let state = step(initialAdoptState, "plugin:votes", "gen-a", 0).state;
    state = step(state, "plugin:votes", "gen-b", 100).state;
    const result = step(state, "plugin:votes", "gen-a", 1_200);
    expect(result.moves).toEqual([]);
  });

  it("the same generation observed again is idempotent — no move, no loop", () => {
    let state = step(initialAdoptState, "plugin:votes", "gen-a", 0).state;
    state = step(state, "plugin:votes", "gen-b", 0).state;
    const moved = step(state, "plugin:votes", "gen-b", 2_000);
    expect(moved.moves).toEqual([{ key: "plugin:votes", content: "gen-b", generation: 1 }]);

    const settled = step(moved.state, "plugin:votes", "gen-b", 3_000);
    expect(settled.moves).toEqual([]);
    const again = step(settled.state, "plugin:votes", "gen-b", 9_000);
    expect(again.moves).toEqual([]);
  });

  it("a missing dist clears pending — nothing adopts a half-written build", () => {
    let state = step(initialAdoptState, "plugin:votes", "gen-a", 0).state;
    state = step(state, "plugin:votes", "gen-b", 100).state;

    const wiped = advance(state, [observation("plugin:votes", null)], 2_000);
    expect(wiped.moves).toEqual([]);
    expect(wiped.state.pending.has("plugin:votes")).toBe(false);
    expect(wiped.state.served.get("plugin:votes")?.content).toBe("gen-a");

    const back = advance(wiped.state, [observation("plugin:votes", fingerprint("gen-b"))], 2_100);
    expect(back.moves).toEqual([]);
  });

  it("a failed adopt re-owes the move — the served entry stays until the adopter commits", () => {
    let state = step(initialAdoptState, "plugin:votes", "gen-a", 0).state;
    state = step(state, "plugin:votes", "gen-b", 100).state;
    const moved = step(state, "plugin:votes", "gen-b", 2_000);
    state = moved.state;
    expect(moved.moves.length).toBe(1);

    // The adopter rolled the served entry back after a failed reload: the
    // settle window re-arms before the same move re-owes.
    const rolledBack: AdoptState = {
      ...state,
      served: new Map([
        ["plugin:votes", { content: "gen-a", fingerprint: fingerprint("gen-a"), generation: 0 }],
      ]),
    };
    let retry = step(rolledBack, "plugin:votes", "gen-b", 4_000);
    expect(retry.moves).toEqual([]);
    retry = step(retry.state, "plugin:votes", "gen-b", 5_100);
    expect(retry.moves).toEqual([{ key: "plugin:votes", content: "gen-b", generation: 1 }]);
  });

  it("units adopt independently", () => {
    let state = initialAdoptState;
    let result = advance(
      state,
      [
        observation("plugin:votes", fingerprint("a")),
        observation("plugin:registry", fingerprint("x")),
      ],
      0,
    );
    state = result.state;

    result = advance(
      state,
      [
        observation("plugin:votes", fingerprint("b")),
        observation("plugin:registry", fingerprint("x")),
      ],
      100,
    );
    state = result.state;

    result = advance(
      state,
      [
        observation("plugin:votes", fingerprint("b")),
        observation("plugin:registry", fingerprint("y")),
      ],
      2_000,
    );
    state = result.state;
    expect(result.moves).toEqual([{ key: "plugin:votes", content: "b", generation: 1 }]);

    result = advance(
      state,
      [
        observation("plugin:votes", fingerprint("b")),
        observation("plugin:registry", fingerprint("y")),
      ],
      3_000,
    );
    expect(result.moves).toEqual([{ key: "plugin:registry", content: "y", generation: 1 }]);
  });

  it("only content counts — mtime-only changes are the same generation", () => {
    const state = step(initialAdoptState, "plugin:votes", "gen-a", 0).state;
    const restamped = advance(
      state,
      [observation("plugin:votes", fingerprint("gen-a", 9_999))],
      2_000,
    );
    expect(restamped.moves).toEqual([]);
    expect(restamped.state.served.get("plugin:votes")?.fingerprint.newestMtimeMs).toBe(9_999);
  });

  it("fingerprintContentOf distinguishes container and manifest content", () => {
    expect(fingerprintContentOf(fingerprint("digest-a"))).toBe("digest-a");
    expect(fingerprintContentOf(fingerprint("digest-b"))).not.toBe(
      fingerprintContentOf(fingerprint("digest-a")),
    );
    expect(fingerprintContentOf(null)).toBe("missing");
  });
});

describe("createBackendFingerprintSampler", () => {
  const workspace = mkdtempSync(join(tmpdir(), "dev-adopt-sampler-"));
  const distDir = join(workspace, "dist");

  beforeAll(() => {
    // The sampler reads a BUILT dist — materialize the minimal fake one at
    // runtime; dist/ is gitignored so a fixture dist would never survive a
    // cold checkout.
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "remoteEntry.js"), 'console.log("sampler fixture");');
    writeFileSync(
      join(distDir, "mf-manifest.json"),
      JSON.stringify({ metaData: { name: "sampler-fixture" } }),
    );
  });

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("reads the built container and manifest of a workspace dist", async () => {
    const sampler = createBackendFingerprintSampler(workspace);
    const first = await sampler();
    expect(first).not.toBeNull();
    const second = await sampler();
    expect(second).toEqual(first);
  });

  it("a changed container moves the digest", async () => {
    const sampler = createBackendFingerprintSampler(workspace);
    const before = await sampler();
    writeFileSync(join(distDir, "remoteEntry.js"), 'console.log("sampler churned");');
    const after = await sampler();
    expect(after).not.toBeNull();
    expect(after!.digest).not.toBe(before!.digest);
  });

  it("returns null for a workspace with no built container", async () => {
    const empty = mkdtempSync(join(tmpdir(), "dev-adopt-sampler-empty-"));
    try {
      const sampler = createBackendFingerprintSampler(empty);
      expect(await sampler()).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
