import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { BosBuilder } from "../../src/commands/shared";
import { registerProcesses } from "../../src/handlers/processes";
import type { PidEntry } from "../../src/process-registry";
import { ProcessesService } from "../../src/services/processes";

let registryDir: string | null = null;

afterEach(() => {
  if (registryDir) {
    rmSync(registryDir, { recursive: true, force: true });
    registryDir = null;
  }
  delete process.env.BO_PID_REGISTRY_PATH;
});

function entry(overrides: Partial<PidEntry>): PidEntry {
  return {
    pid: process.pid,
    configDir: process.cwd(),
    role: "standalone",
    ports: {},
    startedAt: Date.now(),
    description: "test process",
    ...overrides,
  };
}

function withRegistryFile(content: string): string {
  registryDir = mkdtempSync(join(tmpdir(), "bos-processes-"));
  process.env.BO_PID_REGISTRY_PATH = join(registryDir, "pids.json");
  writeFileSync(process.env.BO_PID_REGISTRY_PATH, content);
  return registryDir;
}

function contextWith(service: ProcessesService): Context.Context<ProcessesService> {
  return Context.make(ProcessesService, service);
}

function psEffect(
  context: Context.Context<ProcessesService>,
): Effect.Effect<unknown, unknown, never> {
  const builder = {
    ps: {
      // Mirrors @orpc/experimental-effect's middlewareGen: run the generator,
      // then provide the effect context from the oRPC call context.
      effect: (fn: (opts: unknown) => Generator) => (opts: unknown) => {
        const effect = Effect.gen(() => fn(opts));
        return effect.pipe(Effect.provide(context));
      },
    },
  } as unknown as BosBuilder;
  const router = registerProcesses(builder) as {
    ps: (opts: unknown) => Effect.Effect<unknown, unknown, never>;
  };
  return router.ps({ context: { "effect/context": context } });
}

describe("ps handler", () => {
  it("returns ok with the entries the service listed", async () => {
    const fake = ProcessesService.of({
      list: () => Effect.succeed([entry({ description: "dev" })]),
    });

    const result = (await Effect.runPromise(psEffect(contextWith(fake)))) as {
      status: string;
      entries: PidEntry[];
    };
    expect(result.status).toBe("ok");
    expect(result.entries.map((e) => e.description)).toEqual(["dev"]);
  });

  it("maps a service failure to the error result shape, not a throw", async () => {
    const failing = ProcessesService.of({
      list: () => Effect.fail(new Error("registry exploded")),
    });

    const result = (await Effect.runPromise(psEffect(contextWith(failing)))) as {
      status: string;
      entries: unknown[];
      error?: string;
    };
    expect(result.status).toBe("error");
    expect(result.entries).toEqual([]);
    expect(result.error).toBe("registry exploded");
  });
});

describe("ProcessesService.Live", () => {
  it("reads the registry file and prunes dead entries", async () => {
    withRegistryFile(JSON.stringify([entry({ description: "live" }), entry({ pid: 999_999_9 })]));

    const program = Effect.gen(function* () {
      const processes = yield* ProcessesService;
      return yield* processes.list();
    }).pipe(Effect.provide(ProcessesService.Live));

    const entries = await Effect.runPromise(program);
    expect(entries.map((e) => e.description)).toEqual(["live"]);
  });

  it("treats a malformed registry file as empty, preserving current behavior", async () => {
    withRegistryFile("not json at all");

    const program = Effect.gen(function* () {
      const processes = yield* ProcessesService;
      return yield* processes.list();
    }).pipe(Effect.provide(ProcessesService.Live));

    const entries = await Effect.runPromise(program);
    expect(entries).toEqual([]);
  });
});
