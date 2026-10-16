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

afterEach(() => {
  consoleSpy.mockClear();
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
    const run = async (cmd: string, args: string[], opts: { cwd?: string }) => {
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

  it("passes force to the prerequisite train in deploy mode", async () => {
    const calls: { force?: boolean }[] = [];
    await runDeploy({
      targets: ["ui"],
      deps: makeDeps({
        freshDeps: async (_start, _dirs, opts) => {
          calls.push({ force: opts?.force });
          return { rebuilt: [], fresh: [] };
        },
      }),
    });

    expect(calls).toEqual([{ force: true }]);
  });

  it("skips targets that resolve to no local workspace", async () => {
    const { built, skipped } = await runDeploy({ targets: ["ui", "remote-plugin"] });

    expect(built).toEqual(["ui"]);
    expect(skipped).toEqual(["remote-plugin"]);
  });
});

describe("BuildTrainService", () => {
  it("exposes the build train through the tag and renders via an injected render dep", async () => {
    const rendered: string[] = [];
    const { BuildTrainService } = await import("../../src/services/workspace/build-train");
    const train = BuildTrainService.of({
      buildTargets: (input, deps) =>
        buildWorkspaceTargets(input, {
          ...deps,
          render: { outcome: (outcome) => rendered.push(`${outcome.key}:${outcome.success}`) },
        }),
    });

    const result = await train.buildTargets(
      {
        configDir,
        bosConfig,
        runtimeConfig: null,
        targets: ["ui"],
        deploy: true,
        verbose: false,
      },
      makeDeps(),
    );

    expect(result.built).toEqual(["ui"]);
    expect(rendered).toEqual(["ui:true"]);
  });
});
