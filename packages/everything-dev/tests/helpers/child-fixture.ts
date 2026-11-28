import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "effect";
import { Cause, Data, Effect, Exit } from "effect";
import {
  generateDatabaseMigrations,
  runPnpmApproveAll,
  runPnpmInstall,
} from "../../src/services/scaffold/init";
import type { InitOptions } from "../../src/services/scaffold/init-flow";
import { InitFlowService } from "../../src/services/scaffold/init-flow";
import { runCommand } from "../integration/typecheck-utils";
import { loadParentConfigFixture } from "./parent-config";

export const REPO_ROOT = join(import.meta.dirname, "../../../..");

export type Level = "simple" | "advanced";
export const LEVELS: readonly Level[] = ["simple", "advanced"];

export type Composition = "ui" | "ui+api" | "full";
export const COMPOSITIONS: readonly Composition[] = ["ui", "ui+api", "full"];

export function compositionOverrides(
  composition: Composition,
): Array<"ui" | "api" | "host" | "plugins"> {
  switch (composition) {
    case "ui":
      return ["ui"];
    case "ui+api":
      return ["ui", "api"];
    case "full":
      return ["ui", "api", "host", "plugins"];
  }
}

export function compositionWorkspaces(composition: Composition): string[] {
  switch (composition) {
    case "ui":
      return ["ui"];
    case "ui+api":
      return ["ui", "api"];
    case "full":
      return ["ui", "api", "host", "plugins/_template"];
  }
}

export class GateError extends Data.TaggedError("GateError")<{
  gate: string;
  command: string;
  output: string;
}> {}

export interface GateReport {
  readonly gate: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/** A scaffolded child: hermetic, no node_modules. The scaffold gate's token. */
export interface Scaffolded {
  readonly dir: string;
  readonly level: Level;
  readonly composition: Composition;
  readonly filesCopied: number;
}

/** Install gate passed — token minted by `installChild`. */
export interface Installed extends Scaffolded {
  readonly installed: true;
}

/** Types gate passed — token minted by `typegenChild`. */
export interface Typed extends Installed {
  readonly typed: true;
}

const childBos = (dir: string): string => join(dir, "node_modules", ".bin", "bos");

const gateError = (gate: string, command: string) => (e: unknown) =>
  new GateError({
    gate,
    command,
    output: e instanceof Error ? e.message || String(e) : String(e),
  });

/** Wrap an async unit of work as a gate step that fails with `GateError`. */
export const attempt = (
  gate: string,
  command: string,
  run: () => Promise<unknown>,
): Effect.Effect<unknown, GateError> =>
  Effect.tryPromise({ try: run, catch: gateError(gate, command) });

/**
 * Gate 1 — run the real `InitFlowService` hermetically: source is this repo's
 * tree, and the parent config rides the service's `parentConfig` seam (with
 * the template plugin entry added, the way a published parent config maps the
 * registry key to the `_template` directory). Everything downstream — copy
 * filters, level exclusions, personalization, prune, snapshot, env — is the
 * production flow, not a re-implementation.
 */
export const scaffoldChild = (opts: {
  level: Level;
  composition: Composition;
}): Effect.Effect<Scaffolded, GateError> =>
  Effect.gen(function* () {
    const dir = mkdtempSync(join(tmpdir(), `bos-init-${opts.level}-${opts.composition}-`));
    const fixture = yield* Effect.tryPromise({
      try: () => loadParentConfigFixture(),
      catch: gateError("scaffold", "resolve parent config fixture"),
    });
    const input: InitOptions = {
      directory: dir,
      account: "test.near",
      domain: "test.dev",
      extends: "bos://dev.everything.near/everything.dev",
      level: opts.level,
      overrides: compositionOverrides(opts.composition),
      plugins: opts.composition === "full" ? ["template"] : [],
      source: REPO_ROOT,
      parentConfig: {
        ...fixture,
        plugins: {
          ...(fixture.plugins ?? {}),
          template: { development: "local:plugins/_template" },
        },
      } as InitOptions["parentConfig"],
      noInstall: true,
    };

    const flow = yield* InitFlowService;
    const result = yield* flow.run(input);
    if (result.status !== "initialized") {
      return yield* new GateError({
        gate: "scaffold",
        command: "bos init (InitFlowService)",
        output: result.error ?? "unknown init failure",
      });
    }
    if (result.filesCopied === 0) {
      return yield* new GateError({
        gate: "scaffold",
        command: "bos init (InitFlowService)",
        output: "no files copied — the source tree matched no patterns",
      });
    }
    return {
      dir,
      level: opts.level,
      composition: opts.composition,
      filesCopied: result.filesCopied,
    };
  }).pipe(Effect.provide(InitFlowService.Live));

/**
 * Gate 2 — install + approve, the same exported phases the flow's install leg
 * composes. Framework packages must already be resolvable (tarball rewrite or
 * local links — the lane's job, not this step's).
 */
export const installChild = (child: Scaffolded): Effect.Effect<Installed, GateError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => runPnpmInstall(child.dir),
      catch: gateError("install", "pnpm install --ignore-scripts"),
    });
    const approved = yield* Effect.tryPromise({
      try: () => runPnpmApproveAll(child.dir),
      catch: gateError("approve", "pnpm approve --all"),
    });
    if (!approved) {
      return yield* new GateError({
        gate: "approve",
        command: "pnpm approve --all",
        output: "pnpm approve failed — pending decisions remain",
      });
    }
    return { ...child, installed: true };
  });

/** Gate 3 — types generation, seeded with the hermetic auth stubs. The
 * command is the production one (`node <pkg>/dist/cli.mjs types gen`); the
 * fixture runs it captured so a failure's GateError carries the CLI's real
 * output (the production helper inherits stdio for UX). No stub seeding —
 * gate 4 typechecks the real generated types. */
export const typegenChild = (child: Installed): Effect.Effect<Typed, GateError> =>
  Effect.gen(function* () {
    const cli = join(child.dir, "node_modules", "everything-dev", "dist", "cli.mjs");
    const result = yield* Effect.tryPromise({
      try: () => runCommand(process.execPath, [cli, "types", "gen"], child.dir, 300_000),
      catch: gateError("types", "bos types gen"),
    });
    if (result.code !== 0) {
      return yield* new GateError({
        gate: "types",
        command: "bos types gen",
        output: result.stdout + result.stderr,
      });
    }
    if (!existsSync(join(child.dir, "ui", "src", "lib", "api-types.gen.ts"))) {
      return yield* new GateError({
        gate: "types",
        command: "bos types gen",
        output: "types gen exited 0 but api-types.gen.ts was not written",
      });
    }
    return { ...child, typed: true };
  });

/** The flow's install-leg tail — drift here is a born-healthy failure. */
export const migrateChild = (child: Typed): Effect.Effect<Typed, GateError> =>
  Effect.tryPromise({
    try: () => generateDatabaseMigrations(child.dir),
    catch: gateError("migrations", "drizzle-kit generate"),
  });

/** Gate 4 — each workspace's own `typecheck` script, the child's real gate,
 * against the real generated types (no permissive stubs: components call
 * typed helpers whose `any` receivers turn into implicit-any errors — the
 * stub approach can only ever check api/plugin surfaces). */
export const typecheckChild = (child: Typed): Effect.Effect<GateReport, GateError> =>
  Effect.gen(function* () {
    for (const workspace of compositionWorkspaces(child.composition)) {
      const command = ["--dir", workspace, "run", "typecheck"];
      const result = yield* Effect.tryPromise({
        try: () => runCommand("pnpm", command, child.dir, 240_000),
        catch: gateError(`typecheck:${workspace}`, `pnpm ${command.join(" ")}`),
      });
      if (result.code !== 0) {
        return yield* new GateError({
          gate: `typecheck:${workspace}`,
          command: `pnpm ${command.join(" ")}`,
          output: result.stdout + result.stderr,
        });
      }
    }
    return { gate: "typecheck", ok: true };
  });

/**
 * Gate 5 — `bos build` with a zero-warning budget. The allowlist is empty on
 * day one; an entry requires a named owner + issue (plan 067).
 */
export const WARNING_BUDGET: RegExp[] = [];

export const buildChild = (child: Installed): Effect.Effect<GateReport, GateError> =>
  Effect.gen(function* () {
    const command = ["build"];
    const result = yield* Effect.tryPromise({
      try: () => runCommand(childBos(child.dir), command, child.dir, 600_000),
      catch: gateError("build", `bos ${command.join(" ")}`),
    });
    const output = result.stdout + result.stderr;
    if (result.code !== 0) {
      return yield* new GateError({ gate: "build", command: `bos ${command.join(" ")}`, output });
    }
    const warnings = output
      .split("\n")
      .filter((line) => /warning/i.test(line))
      .filter((line) => !WARNING_BUDGET.some((pattern) => pattern.test(line)));
    if (warnings.length > 0) {
      return yield* new GateError({
        gate: "build-warnings",
        command: `bos ${command.join(" ")}`,
        output: warnings.join("\n"),
      });
    }
    return { gate: "build", ok: true };
  });

/** Gate 8 — the lifecycle seam: `bos upgrade --check` is well-formed. */
export const upgradeCheckChild = (child: Installed): Effect.Effect<GateReport, GateError> =>
  Effect.gen(function* () {
    const command = ["upgrade", "--check", "--json"];
    const result = yield* Effect.tryPromise({
      try: () => runCommand(childBos(child.dir), command, child.dir, 240_000),
      catch: gateError("upgrade-check", `bos ${command.join(" ")}`),
    });
    if (![0, 1].includes(result.code)) {
      return yield* new GateError({
        gate: "upgrade-check",
        command: `bos ${command.join(" ")}`,
        output: result.stdout + result.stderr,
      });
    }
    let report: { error?: string; release?: { resolved?: string } };
    try {
      report = JSON.parse(result.stdout);
    } catch {
      return yield* new GateError({
        gate: "upgrade-check",
        command: `bos ${command.join(" ")}`,
        output: `unparseable --json output:\n${result.stdout}\n${result.stderr}`,
      });
    }
    if (report.error !== undefined) {
      return yield* new GateError({
        gate: "upgrade-check",
        command: `bos ${command.join(" ")}`,
        output: result.stdout,
      });
    }
    if (!/^\d+\.\d+\.\d+/.test(report.release?.resolved ?? "")) {
      return yield* new GateError({
        gate: "upgrade-check",
        command: `bos ${command.join(" ")}`,
        output: `no resolved release semver in:\n${result.stdout}`,
      });
    }
    return { gate: "upgrade-check", ok: true };
  });

const LOCAL_FRAMEWORK_PACKAGES: Array<[name: string, dir: string]> = [
  ["everything-dev", "packages/everything-dev"],
  ["every-plugin", "packages/every-plugin"],
];

/** Everything-dev's build needs its prerequisites' dists too (the train's
 * prerequisite graph). A fresh worktree has none — and the staleness oracle
 * reads a missing dist as fresh, so the lane must build before packing. */
const FRAMEWORK_DIST_DIRS = [
  "packages/better-near-auth",
  "packages/every-plugin",
  "packages/everything-dev",
];

export const ensureFrameworkDists = (): Effect.Effect<void, GateError> =>
  Effect.gen(function* () {
    const missing = FRAMEWORK_DIST_DIRS.some((dir) => !existsSync(join(REPO_ROOT, dir, "dist")));
    if (!missing) return;
    yield* Effect.tryPromise({
      try: () => runCommand("pnpm", ["run", "build", "template"], REPO_ROOT, 600_000),
      catch: gateError("framework-dists", "pnpm run build template"),
    });
  });

/**
 * Boot-lane prep: pin the child's framework packages to THIS tree with
 * workspace `overrides:` links. The boot gates exercise this tree's scaffold
 * output end to end.
 */
export const linkLocalFramework = (child: Scaffolded): Effect.Effect<GateReport, GateError> =>
  Effect.gen(function* () {
    yield* ensureFrameworkDists();
    const workspacePath = join(child.dir, "pnpm-workspace.yaml");
    const lines = readFileSync(workspacePath, "utf8").split("\n");
    const linkLines = LOCAL_FRAMEWORK_PACKAGES.map(
      ([name, dir]) => `  ${name}: "link:${join(REPO_ROOT, dir)}"`,
    );
    const overridesIdx = lines.indexOf("overrides:");
    const next =
      overridesIdx === -1
        ? [...lines, "overrides:", ...linkLines]
        : [...lines.slice(0, overridesIdx + 1), ...linkLines, ...lines.slice(overridesIdx + 1)];
    writeFileSync(workspacePath, `${next.join("\n")}\n`);
    return { gate: "framework-links", ok: true };
  });

export const BOOT_PORTS = { host: 4270, api: 4271, auth: 4272, ui: 4273, plugins: 4280 };

export interface BootEvidence {
  /** Gate 6 — the ui answered before its budget elapsed. */
  readonly uiStatus: number;
  /** Gate 6 — the api answered before its budget elapsed. */
  readonly apiStatus: number;
  /** The full boot log — the clean-log assertions read this. */
  readonly log: string;
  /** SIGTERM sufficed: no SIGKILL escalation, process reaped. */
  readonly quitCleanly: boolean;
}

interface DevHandle {
  readonly child: ReturnType<typeof spawn>;
  readonly args: string[];
  log: string;
  killed: boolean;
}

/**
 * Gate 6 — boot the child under `bos dev` as a scoped resource: acquired when
 * spawned, ready when the ui answers, released by the SIGTERM → 30s → SIGKILL
 * escalation. Evidence is data collected across the scope's lifetime; the
 * release finalizer writes the quit verdict before the value is returned.
 */
/**
 * The boot range is reserved for init boot tests; a listener left by an
 * earlier crashed run answers probes and poisons the quit verdict (the
 * zombie from the deleted fresh-init-dev run did exactly that). Best-effort
 * clear before spawning — same hygiene as the framework suite's port blocks.
 */
const killStaleBootPorts = (): void => {
  for (const port of Object.values(BOOT_PORTS)) {
    try {
      const result = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf-8" });
      for (const pid of (result.stdout ?? "").split("\n")) {
        const trimmed = pid.trim();
        if (/^\d+$/.test(trimmed)) {
          try {
            process.kill(Number(trimmed), "SIGKILL");
          } catch {
            // already gone
          }
        }
      }
    } catch {
      // lsof unavailable — nothing to clear
    }
  }
};

export const bootChild = (
  child: Scaffolded,
  ports: typeof BOOT_PORTS = BOOT_PORTS,
): Effect.Effect<BootEvidence, GateError, Scope> =>
  Effect.gen(function* () {
    const devArgs = [
      "dev",
      "--no-interactive",
      "--port",
      String(ports.host),
      "--api-port",
      String(ports.api),
      "--auth-port",
      String(ports.auth),
      "--ui-port",
      String(ports.ui),
      "--plugin-port-start",
      String(ports.plugins),
    ];
    const evidence: BootEvidence = {
      uiStatus: 0,
      apiStatus: 0,
      log: "",
      quitCleanly: false,
    };

    yield* Effect.acquireRelease(
      Effect.gen(function* () {
        killStaleBootPorts();
        const handle: DevHandle = {
          child: spawn(childBos(child.dir), devArgs, {
            cwd: child.dir,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, BOS_NO_PERSIST_PORTS: "1", BOS_NO_BANNER: "1" },
          }),
          args: devArgs,
          log: "",
          killed: false,
        };
        const append = (chunk: Buffer) => {
          handle.log += chunk.toString();
        };
        handle.child.stdout?.on("data", append);
        handle.child.stderr?.on("data", append);

        const waitFor = (port: number, label: string, budgetMs: number) =>
          Effect.gen(function* () {
            const deadline = Date.now() + budgetMs;
            const probe = (host: string) =>
              fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(2000) })
                .then((res) => (res.status < 600 ? res.status : null))
                .catch(() => null);
            while (Date.now() < deadline) {
              if (handle.child.exitCode !== null) {
                return yield* new GateError({
                  gate: `boot:${label}`,
                  command: `bos dev (${devArgs.join(" ")})`,
                  output: `bos dev exited before serving ${label} (${handle.child.exitCode})\n${handle.log}`,
                });
              }
              // Dev servers bind "localhost" — macOS resolves it to ::1 first,
              // so dial both families before declaring the port dead.
              const status =
                (yield* Effect.promise(() => probe("127.0.0.1"))) ??
                (yield* Effect.promise(() => probe("localhost")));
              if (status !== null) return status;
              yield* Effect.sleep(1000);
            }
            return yield* new GateError({
              gate: `boot:${label}`,
              command: `bos dev (${devArgs.join(" ")})`,
              output: `${label} not serving after ${budgetMs}ms\n${handle.log}`,
            });
          });

        evidence.uiStatus = yield* waitFor(ports.ui, "ui", 240_000);
        evidence.apiStatus = yield* waitFor(ports.api, "api", 60_000);
        evidence.log = handle.log;
        return handle;
      }),
      (handle) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            if (handle.child.exitCode !== null) return;
            handle.child.kill("SIGTERM");
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                handle.killed = true;
                handle.child.kill("SIGKILL");
                resolve();
              }, 30_000);
              handle.child.once("close", () => {
                clearTimeout(timer);
                resolve();
              });
            });
          });
          evidence.log = handle.log;
          evidence.quitCleanly = !handle.killed && handle.child.exitCode !== null;
        }),
    );

    return evidence;
  });

/**
 * Known born-healthy defects — live consumer bugs the matrix caught, asserted
 * red so the cell documents reality until the framework fix lands. When a fix
 * makes a gate pass, the `expected false` in the lane assertions FAILS and
 * forces the row's deletion (the flip is the reminder). Details in
 * `.scratch/init-born-healthy/issues/`.
 */
export const KNOWN_DEFECTS: Array<{
  level: Level | "all";
  gates: string[];
  reason: string;
  detailMatches?: RegExp;
}> = [
  {
    // ui typecheck: the deployed auth plugin manifest carries no
    // `additionalExports`, so remote children keep the `Auth = any` stub and
    // every auth-chained component fails noImplicitAny. Needs the auth build
    // to emit + declare auth-export types, then a republish. (#936)
    level: "all",
    gates: ["typecheck"],
    reason: "auth plugin publishes no additionalExports — ui typechecks against any stubs",
  },
];

export function findKnownDefect(
  level: Level,
  gate: string,
): (typeof KNOWN_DEFECTS)[number] | undefined {
  return KNOWN_DEFECTS.find(
    (entry) => (entry.level === level || entry.level === "all") && entry.gates.includes(gate),
  );
}

/**
 * The born-healthy lane runner: sequential steps, first failure blocks the
 * rest, every gate reports. The report array is data — tests assert rows,
 * never runner ordering. Steps may require `Scope` (the boot gate's server);
 * run the lane under `Effect.scoped`.
 */
export const runLane = (
  steps: Array<{ gate: string; effect: Effect.Effect<unknown, GateError, Scope> }>,
): Effect.Effect<GateReport[], never, Scope> =>
  Effect.gen(function* () {
    const reports: GateReport[] = [];
    let blockedBy: string | null = null;
    for (const step of steps) {
      if (blockedBy !== null) {
        reports.push({ gate: step.gate, ok: false, detail: `blocked by ${blockedBy}` });
        continue;
      }
      const exit = yield* Effect.exit(step.effect);
      if (Exit.isSuccess(exit)) {
        reports.push({ gate: step.gate, ok: true });
      } else {
        const error = Cause.squash(exit.cause) as GateError;
        reports.push({
          gate: step.gate,
          ok: false,
          detail: `${error.command}\n${error.output}`,
        });
        blockedBy = step.gate;
      }
    }
    return reports;
  });
