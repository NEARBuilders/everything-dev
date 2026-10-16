import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BuildTargetsDeps,
  buildWorkspaceTargets,
  type WorkspaceBuildOutcome,
  type WorkspaceBuildRender,
} from "../../src/services/workspace/build-train";
import type { BosConfig } from "../../src/types";

const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

const tmpRoots: string[] = [];

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterEach(() => {
  consoleSpy.mockClear();
  return () => consoleSpy.mockRestore();
});

const configDir = tmpdir();

const bosConfig = {
  account: "dev.everything.near",
  app: {
    ui: { development: "local:ui" },
    host: { development: "local:host" },
    api: { development: "local:api" },
  },
  plugins: {},
} as unknown as BosConfig;

function makeDeps(
  overrides: {
    run?: BuildTargetsDeps["runChild"];
    freshDeps?: BuildTargetsDeps["freshDeps"];
    render?: WorkspaceBuildRender;
  } = {},
): BuildTargetsDeps {
  return {
    runChild: overrides.run ?? (async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    freshDeps: overrides.freshDeps ?? (async () => ({ rebuilt: [], fresh: [] })),
    fileExists: async () => true,
    render: overrides.render,
  };
}

type RunEvent = { target: string; event: "start" | "end" };

async function runDeploy(input: { targets?: string[]; deps?: BuildTargetsDeps }) {
  return buildWorkspaceTargets(
    {
      configDir,
      bosConfig,
      runtimeConfig: null,
      targets: input.targets ?? ["ui", "host"],
      deploy: true,
      verbose: false,
    },
    input.deps ?? makeDeps(),
  );
}

describe("buildWorkspaceTargets", () => {
  it("runs the deploy build train with non-host targets in parallel and host after", async () => {
    const events: RunEvent[] = [];
    const run = async (_cmd: string, _args: string[], opts: { cwd?: string } | undefined) => {
      const target = opts.cwd?.split("/").pop() ?? "?";
      events.push({ target, event: "start" });
      await Promise.resolve();
      events.push({ target, event: "end" });
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const { built } = await runDeploy({ deps: makeDeps({ run }) });

    expect(built).toEqual(["ui", "host"]);
    expect(events.map((e) => `${e.target}:${e.event}`)).toEqual([
      "ui:start",
      "ui:end",
      "host:start",
      "host:end",
    ]);
  });

  it("buffers child stderr and attributes warnings to the workspace outcome", async () => {
    const run = async (
      _cmd: string,
      _args: string[],
      opts: { onChunk?: (stream: "stdout" | "stderr", chunk: Buffer) => void } | undefined,
    ) => {
      // Simulate a plugin build via the chunk stream: a banner line, a
      // WARNING box, ordinary noise.
      opts?.onChunk?.("stderr", Buffer.from("$ every-plugin build\n"));
      opts?.onChunk?.("stderr", Buffer.from("WARNING in ./src/index.ts\n"));
      opts?.onChunk?.("stderr", Buffer.from("  ⚠ something smells (rsbuild)\n\n"));
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const outcomes: WorkspaceBuildOutcome[] = [];
    const render: WorkspaceBuildRender = { outcome: (o) => outcomes.push(o) };
    const { built } = await runDeploy({
      targets: ["ui"],
      deps: makeDeps({ run, render }),
    });

    expect(built).toEqual(["ui"]);
    const warnings = outcomes[0]?.warnings ?? [];
    expect(warnings.some((w) => w.includes("WARNING in ./src/index.ts"))).toBe(true);
    expect(warnings.some((w) => w.includes("every-plugin build"))).toBe(false);
  });

  it("caps parallel deploy builds at the input concurrency", async () => {
    let running = 0;
    let maxRunning = 0;
    let releases: Array<() => void> = [];
    const run = async (_cmd: string, _args: string[], _opts: { cwd?: string } | undefined) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((resolve) => releases.push(resolve));
      running -= 1;
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const deferredRun = new Proxy(run, {
      // Release each build on its next tick after all four start, so the cap
      // is what bounds concurrency — not early completions.
      apply(target, _context, args) {
        const result = Reflect.apply(target, _context, args);
        queueMicrotask(() => {
          const release = releases.shift();
          release?.();
        });
        return result;
      },
    });

    const scopedConfig = {
      ...bosConfig,
      plugins: {
        votes: { development: "local:plugins/votes" },
        registry: { development: "local:plugins/registry" },
      },
    } as unknown as BosConfig;

    const { built } = await buildWorkspaceTargets(
      {
        configDir,
        bosConfig: scopedConfig,
        runtimeConfig: null,
        targets: ["ui", "api", "votes", "registry", "host"],
        deploy: true,
        verbose: false,
        concurrency: 2,
      },
      makeDeps({ run: deferredRun }),
    );

    expect(built).toContain("ui");
    expect(maxRunning).toBe(2);
    releases = [];
  });

  it("attributes captured stderr to the workspace outcome", async () => {
    const outcomes: WorkspaceBuildOutcome[] = [];
    const render: WorkspaceBuildRender = {
      outcome: (outcome) => outcomes.push(outcome),
    };

    await runDeploy({
      targets: ["ui"],
      deps: makeDeps({
        run: async () => ({ stdout: "", stderr: "warn: deprecation\n", exitCode: 0 }),
        render,
      }),
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.key).toBe("ui");
    expect(outcomes[0]?.stderr).toBe("warn: deprecation\n");
  });

  it("renders banner, outcomes and a trailing newline through the render dep without touching the console", async () => {
    const banners: number[] = [];
    const rendered: string[] = [];
    const ends: boolean[] = [];
    const render: WorkspaceBuildRender = {
      banner: (total) => banners.push(total),
      prerequisites: (names) => rendered.push(`prerequisites:${names.join(",")}`),
      outcome: (outcome) => rendered.push(`${outcome.success ? "ok" : "err"}:${outcome.key}`),
      end: () => ends.push(true),
    };

    const { deployResults } = await runDeploy({ deps: makeDeps({ render }) });

    expect(banners).toEqual([2]);
    expect(rendered).toEqual(["ok:ui", "ok:host"]);
    expect(ends).toEqual([true]);
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(deployResults?.map((r) => r.key)).toEqual(["ui", "host"]);
  });

  it("renders rebuilt prerequisites with their workspace names", async () => {
    const rendered: string[] = [];
    const render: WorkspaceBuildRender = {
      prerequisites: (names) => rendered.push(names.join(",")),
    };

    await runDeploy({
      targets: ["ui"],
      deps: makeDeps({
        render,
        freshDeps: async () => ({
          rebuilt: [{ name: "every-plugin", dir: "", localDeps: [] }],
          fresh: [],
        }),
      }),
    });

    expect(rendered).toEqual(["every-plugin"]);
  });

  it("reports a failed workspace with the output tail and excludes it from built", async () => {
    const outcomes: WorkspaceBuildOutcome[] = [];
    const render: WorkspaceBuildRender = {
      outcome: (outcome) => outcomes.push(outcome),
    };

    const { built, deployResults } = await runDeploy({
      targets: ["ui"],
      deps: makeDeps({
        render,
        run: async () => ({
          stdout: "line1\nline2\nline3\nline4\nline5\nline6",
          stderr: "",
          exitCode: 2,
        }),
      }),
    });

    expect(built).toEqual([]);
    expect(deployResults?.[0]?.success).toBe(false);
    expect(outcomes[0]?.error).toContain("Build failed (exit code 2)");
    expect(outcomes[0]?.error).toContain("line3");
    expect(outcomes[0]?.error).not.toContain("line1\nline2");
  });

  it("emits no outcome events in non-deploy mode", async () => {
    const rendered: WorkspaceBuildOutcome[] = [];
    const render: WorkspaceBuildRender = { outcome: (outcome) => rendered.push(outcome) };

    const { built } = await buildWorkspaceTargets(
      {
        configDir,
        bosConfig,
        runtimeConfig: null,
        targets: ["ui", "host"],
        deploy: false,
      },
      makeDeps({ render }),
    );

    expect(built).toEqual(["ui", "host"]);
    expect(rendered).toEqual([]);
  });

  it("consults the content-hash oracle on deploy; forceBuild keeps the blanket force", async () => {
    const wsRoot = mkdtempSync(join(tmpdir(), "bos-train-root-"));
    tmpRoots.push(wsRoot);
    writeFileSync(join(wsRoot, "pnpm-workspace.yaml"), "packages:\n  - ui\n");
    mkdirSync(join(wsRoot, "ui"), { recursive: true });

    const calls: { force?: boolean; oracle?: boolean }[] = [];
    const probe = async (
      _start: unknown,
      _dirs: unknown,
      opts: { force?: boolean; oracle?: unknown },
    ) => {
      calls.push({ force: opts?.force, oracle: opts?.oracle !== undefined });
      return { rebuilt: [], fresh: [] };
    };

    const run = async (targets: string[], deploy: boolean, forceBuild?: boolean) =>
      buildWorkspaceTargets(
        {
          configDir: wsRoot,
          bosConfig,
          runtimeConfig: null,
          targets,
          deploy,
          verbose: false,
          ...(forceBuild ? { forceBuild: true } : {}),
        },
        makeDeps({ freshDeps: probe }),
      );

    await run(["ui"], true);
    await run(["ui"], true, true);
    await run(["ui"], false);

    expect(calls).toEqual([
      { force: false, oracle: true },
      { force: true, oracle: false },
      { force: false, oracle: false },
    ]);
  });

  it("skips targets that resolve to no local workspace", async () => {
    const { built, skipped } = await runDeploy({ targets: ["ui", "remote-plugin"] });

    expect(built).toEqual(["ui"]);
    expect(skipped).toEqual(["remote-plugin"]);
  });
});

function makeRealTargetRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "build-train-live-"));
  for (const key of ["ui", "host"]) {
    mkdirSync(join(root, key), { recursive: true });
    writeFileSync(join(root, key, "package.json"), "{}\n");
  }
  tmpRoots.push(root);
  return root;
}

describe("BuildTrainService", () => {
  it("Live resolves the composition-provided render through the context", async () => {
    const rendered: string[] = [];
    const { BuildTrainService, WorkspaceBuildRenderService } = await import(
      "../../src/services/workspace/build-train"
    );
    const { Effect, Layer } = await import("effect");

    const result = await Effect.gen(function* () {
      const train = yield* BuildTrainService;
      return yield* Effect.promise(() =>
        train.buildTargets(
          {
            configDir: makeRealTargetRoot(),
            bosConfig,
            runtimeConfig: null,
            targets: ["ui"],
            deploy: true,
            verbose: false,
          },
          makeDeps(),
        ),
      );
    }).pipe(
      Effect.provide(BuildTrainService.Live),
      Effect.provide(
        Layer.succeed(
          WorkspaceBuildRenderService,
          WorkspaceBuildRenderService.of({
            outcome: (outcome) => rendered.push(`${outcome.key}:${outcome.success}`),
          }),
        ),
      ),
      Effect.runPromise,
    );

    expect(result.built).toEqual(["ui"]);
    expect(rendered).toEqual(["ui:true"]);
  });

  it("Live falls back to a quiet render when the composition provides none", async () => {
    const { BuildTrainService } = await import("../../src/services/workspace/build-train");
    const { Effect } = await import("effect");

    const result = await Effect.gen(function* () {
      const train = yield* BuildTrainService;
      return yield* Effect.promise(() =>
        train.buildTargets(
          {
            configDir: makeRealTargetRoot(),
            bosConfig,
            runtimeConfig: null,
            targets: ["ui"],
            deploy: true,
            verbose: false,
          },
          makeDeps(),
        ),
      );
    })
      .pipe(Effect.provide(BuildTrainService.Live), Effect.runPromise)
      .then((result) => ({ ...result, renderedOk: consoleSpy.mock.calls.length === 0 }));

    expect(result.built).toEqual(["ui"]);
    expect(result.renderedOk).toBe(true);
  });
});
