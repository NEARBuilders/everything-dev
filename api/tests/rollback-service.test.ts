import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { RegistryHistoryEntry } from "@/lib/deploy-history";
import {
  buildRollbackService,
  type RollbackDeps,
  type RollbackResult,
} from "@/lib/rollback-service";

const NS = { account: "app1.near", gateway: "app1.dev" };
const CONFIG_KEY = `apps/${NS.account}/${NS.gateway}/bos.config.json`;
const MANIFEST_KEY_PREFIX = `apps/${NS.account}/${NS.gateway}/manifests/`;

interface Fixture {
  deps: RollbackDeps;
  service: {
    rollback: (input: {
      account: string;
      gateway: string;
      blockHeight: number;
    }) => Effect.Effect<RollbackResult>;
  };
  setHistory: (entries: RegistryHistoryEntry[]) => void;
  setLive: (value: unknown) => void;
  failVerify: (slot: string) => void;
  makeUnverifiable: () => void;
  failSubmit: (message: string) => void;
  submissions: () => Array<{ args: Record<string, string>; account: string }>;
}

function fixture(config: { account: string; gateway: string } | undefined = { ...NS }): Fixture {
  let entries: RegistryHistoryEntry[] = [];
  let live: unknown = { plugins: { votes: "v2" } };
  let verifyFailureSlot: string | undefined;
  let unverifiable = false;
  let submitError: string | undefined;
  const submitted: Array<{ args: Record<string, string>; account: string }> = [];

  const deps: RollbackDeps = {
    fetchConfigEntries: vi.fn((input: { account: string; gateway: string; limit: number }) => {
      expect(input.account).toBe(NS.account);
      expect(input.gateway).toBe(NS.gateway);
      return Effect.succeed(entries);
    }),
    fetchLiveConfig: vi.fn(() => Effect.succeed(live)),
    fetchManifestRegistryUrl: vi.fn(() => Effect.succeed("https://cdn.example.com/bundles")),
    verifySnapshot: vi.fn((_config: unknown) => {
      if (unverifiable) return Effect.succeed({ verifiable: false, ok: false, slots: [] });
      if (verifyFailureSlot) {
        return Effect.succeed({
          verifiable: true,
          ok: false,
          slots: [{ slot: verifyFailureSlot, ok: false, reason: "SRI mismatch" }],
        });
      }
      return Effect.succeed({
        verifiable: true,
        ok: true,
        slots: [{ slot: "plugins.votes", ok: true }],
      });
    }),
    submit: vi.fn((input: { account: string; args: Record<string, string> }) => {
      if (submitError) return Effect.fail({ message: submitError });
      submitted.push({ args: input.args, account: input.account });
      return Effect.succeed({ txHash: "tx-123" });
    }),
    now: () => "2026-10-22T12:00:00.000Z",
  } as unknown as RollbackDeps;

  const service = buildRollbackService(deps, config);

  return {
    deps,
    service,
    setHistory: (next) => {
      entries = next;
    },
    setLive: (value) => {
      live = value;
    },
    failVerify: (slot) => {
      verifyFailureSlot = slot;
      unverifiable = false;
    },
    makeUnverifiable: () => {
      unverifiable = true;
      verifyFailureSlot = undefined;
    },
    failSubmit: (message) => {
      submitError = message;
    },
    submissions: () => submitted,
  };
}

const historyEntry = (blockHeight: number, value: unknown): RegistryHistoryEntry => ({
  key: CONFIG_KEY,
  blockHeight,
  blockTimestampNs: String(blockHeight),
  value,
});

const runService = (
  deps: RollbackDeps,
  identity: { account: string; gateway: string } | undefined,
  blockHeight: number,
): Promise<RollbackResult> =>
  Effect.runPromise(buildRollbackService(deps, identity).rollback({ ...NS, blockHeight }));

const run = (f: Fixture, blockHeight: number): Promise<RollbackResult> =>
  Effect.runPromise(f.service.rollback({ ...NS, blockHeight }));

describe("rollback service", () => {
  it("refuses when the runtime has no rollback config", async () => {
    const f = fixture();
    const result = await runService(f.deps, undefined, 100);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/not configured/i);
  });

  it("refuses a namespace this runtime does not own", async () => {
    const f = fixture();
    const result = await Effect.runPromise(
      buildRollbackService(f.deps, { account: "other.near", gateway: "other.dev" }).rollback({
        account: "app1.near",
        gateway: "app1.dev",
        blockHeight: 100,
      }),
    );
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/signs for/i);
  });

  it("refuses an unknown block height", async () => {
    const f = fixture();
    f.setHistory([historyEntry(110, { plugins: { votes: "v1" } })]);
    const result = await run(f, 100);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/no published snapshot/i);
  });

  it("refuses a snapshot identical to the live config", async () => {
    const f = fixture();
    const same = { plugins: { votes: "v2" } };
    f.setHistory([historyEntry(100, same)]);
    f.setLive(same);
    const result = await run(f, 100);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/identical/i);
    expect(f.submissions()).toHaveLength(0);
  });

  it("refuses a verifiable snapshot whose pinned slot fails SRI — publish never happens", async () => {
    const f = fixture();
    f.setHistory([historyEntry(100, { plugins: { votes: "v1" } })]);
    f.failVerify("plugins.votes");
    const result = await run(f, 100);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/SRI|bytes/i);
    expect(f.submissions()).toHaveLength(0);
  });

  it("refuses a pre-pin snapshot — no server-side force", async () => {
    const f = fixture();
    f.setHistory([historyEntry(100, { plugins: { votes: "v1" } })]);
    f.makeUnverifiable();
    const result = await run(f, 100);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toMatch(/predates|version manifests/i);
    expect(f.submissions()).toHaveLength(0);
  });

  it("stamps rolledBackFrom and atomically writes config + audit manifest", async () => {
    const f = fixture();
    f.setHistory([historyEntry(100, { plugins: { votes: "v1" } })]);
    const result = await run(f, 100);
    expect(result).toEqual({
      status: "published",
      txHash: "tx-123",
      blockHeight: 100,
    });
    const submissions = f.submissions();
    expect(submissions).toHaveLength(1);
    const [submission] = submissions;
    if (!submission) throw new Error("no submission recorded");
    expect(submission.account).toBe(NS.account);
    const configValue = JSON.parse(submission.args[CONFIG_KEY] ?? "{}");
    expect(configValue.plugins).toEqual({ votes: "v1" });
    expect(configValue.rolledBackFrom).toBe("2026-10-22T12:00:00.000Z");
    const manifestKeys = Object.keys(submission.args).filter((key) =>
      key.startsWith(MANIFEST_KEY_PREFIX),
    );
    expect(manifestKeys).toHaveLength(1);
    const manifest = JSON.parse(submission.args[manifestKeys[0] ?? ""] ?? "{}");
    expect(manifest).toMatchObject({
      account: NS.account,
      gateway: NS.gateway,
      network: "mainnet",
      publishedAt: "2026-10-22T12:00:00.000Z",
    });
    expect(Object.keys(submission.args)).toHaveLength(2);
  });

  it("surfaces a signing failure without partial state", async () => {
    const f = fixture();
    f.setHistory([historyEntry(100, { plugins: { votes: "v1" } })]);
    f.failSubmit("insufficient funds");
    const result = await run(f, 100);
    expect(result.status).toBe("refused");
    expect((result as { reason: string }).reason).toContain("insufficient funds");
  });

  it("tolerates an unreachable live config (the snapshot publish is idempotent)", async () => {
    const f = fixture();
    f.setHistory([historyEntry(100, { plugins: { votes: "v1" } })]);
    (f.deps.fetchLiveConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      Effect.fail({ message: "HTTP 503" }),
    );
    const result = await run(f, 100);
    expect(result.status).toBe("published");
  });
});
