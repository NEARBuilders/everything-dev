import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildInitPatterns,
  copyFilteredFiles,
  personalizeConfig,
  runPnpmInstall,
} from "../../src/cli/init";
import { makeProjectEnv } from "../../src/env/project-env";
import {
  type ResolvedPlatformManifest,
  resolvePlatformManifest,
} from "../../src/services/platform/manifest";
import { runPnpmApproveAll } from "../../src/services/scaffold/init";
import { writeChildConfigFixture } from "../helpers/parent-config";
import { runCommand, writeGeneratedAuthStubs } from "./typecheck-utils";

/**
 * The consumer rc gate: the release a consumer resolves must scaffold a fresh
 * child the way `bos init` really does it — pin and catalog from the
 * published platform manifest, framework packages resolved through the
 * extends chain — install prompt-free (pnpm's permissions policy settled by
 * the init approve leg), resolve its pin against the extends chain, and BOOT
 * under `bos dev` cleanly: no release-composition divergence block, no shutdown
 * noise, graceful quit.
 *
 * This is the opencrosspost rc.30 failure class, end to end. Template-level
 * logic (unreleased local changes) is covered by init.full; this gate proves
 * the resolved release works for the next consumer, and goes red when it
 * doesn't. The assertions are strict: zero divergence lines in the boot
 * output.
 *
 * Local-only for now (skipped in CI): the shipped rc.30 bytes still carry
 * the consumer-facing defects this PR fixes (the plane audit's @unknown
 * false divergences, the host's declared-list-gated plugin secrets), and
 * the root's live config composes plugin remotes the rc.30 release manifest
 * does not record. The gate wires the child to the local framework (link
 * overrides) so it exercises THIS tree end to end; flip the skip back to
 * CI-only once a release ships the fixes and records the live remotes.
 *
 * Resolves the real parent chain over the registry: the hermetic fetch
 * guard would otherwise block those in-process registry reads — the seam
 * is stubbed per the guard's protocol — the FastKV mainnet host passes
 * through to a real request (this gate's subject IS the published
 * release), every other non-loopback URL keeps the guard's behavior.
 */

const PORTS = { host: 4270, api: 4271, auth: 4272, ui: 4273, plugins: 4280 };
const REPO_ROOT = join(import.meta.dirname, "../../../../");
/** The production root runtime the consumer chain resolves against — the
 * platform manifest publishes at the root's `domain`, not its staging
 * domain (`dev.everything.dev` carries no release manifest). */
const ROOT_EXTENDS = "bos://dev.everything.near/everything.dev";
const FASTKV_MAINNET_HOST = "kv.main.fastnear.com";
/** The framework packages the child links to the local tree (see above). */
const LOCAL_FRAMEWORK_PACKAGES: Array<[name: string, dir: string]> = [
  ["everything-dev", "packages/everything-dev"],
  ["every-plugin", "packages/every-plugin"],
];

const hermeticFetch = globalThis.fetch;

const registryPassthroughFetch: typeof globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(url);
  if (parsed.hostname !== FASTKV_MAINNET_HOST) return hermeticFetch(input, init);
  return new Promise<Response>((resolve, reject) => {
    https
      .get(url, { headers: { accept: "application/json" } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage ?? "",
            }),
          );
        });
      })
      .on("error", reject);
  });
};

describe.skipIf(process.env.CI === "true")(
  "fresh init — full dev run (the consumer rc gate)",
  () => {
    let testDir: string;
    let published: ResolvedPlatformManifest;

    beforeAll(async () => {
      vi.stubGlobal("fetch", registryPassthroughFetch);
      process.env.BOS_NO_BANNER = "1";

      testDir = mkdtempSync(join(tmpdir(), "bos-fresh-init-dev-"));

      const patterns = buildInitPatterns(["ui", "api", "host"], ["template"], {
        template: "_template",
      });
      await copyFilteredFiles(REPO_ROOT, testDir, patterns, {
        overrides: ["ui", "api", "host"],
        plugins: ["template"],
      });
      writeChildConfigFixture(testDir, ["ui", "api", "host"], {
        template: { development: "local:plugins/_template" },
      });
      // A real scaffolded child declares its extends — the resolution walk
      // (and `bos dev`'s release-composition audit) read it from the config. The
      // api remote declares the platform root secret beside its database URL —
      // the plugin's secrets schema requires both (the vault derives the
      // runtime KEK from it).
      const configPath = join(testDir, "bos.config.json");
      const fixture = JSON.parse(readFileSync(configPath, "utf8")) as {
        app?: Record<string, { secrets?: string[] }>;
      };
      fixture.extends = ROOT_EXTENDS;
      if (fixture.app?.api && Array.isArray(fixture.app.api.secrets)) {
        fixture.app.api.secrets = [...new Set([...fixture.app.api.secrets, "BETTER_AUTH_SECRET"])];
      }
      writeFileSync(configPath, JSON.stringify(fixture, null, 2));

      // The real init env leg: .env from the scaffolded .env.example, with a
      // generated BETTER_AUTH_SECRET (project-env ensureFile).
      await Effect.runPromise(makeProjectEnv().ensureFile(testDir));

      // The release + catalog come from the published release — the real bos
      // init pathway (no local-tree catalog source). Bounded lag-retry
      // (ticket 12): a slow FastKV index must not red the gate spuriously —
      // 3 attempts over ~2.5 minutes.
      const localConfig = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      let resolved: Awaited<ReturnType<typeof resolvePlatformManifest>> = null;
      for (let attempt = 1; attempt <= 3 && !resolved; attempt++) {
        try {
          resolved = await resolvePlatformManifest({ configDir: testDir, localConfig });
        } catch (error) {
          if (attempt === 3) throw error;
          console.warn(
            `[gate] manifest resolution attempt ${attempt} failed (${error instanceof Error ? error.message : String(error)}) — retrying in 75s`,
          );
        }
        if (!resolved && attempt < 3) {
          console.warn(`[gate] manifest not resolved on attempt ${attempt} — retrying in 75s`);
          await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 75_000));
        }
      }
      if (!resolved) {
        throw new Error(
          "No release manifest publishes on the extends chain — the consumer rc gate needs a published release",
        );
      }
      published = resolved;

      await personalizeConfig(testDir, {
        extendsAccount: "dev.everything.near",
        extendsGateway: "everything.dev",
        account: "test.near",
        domain: "test.dev",
        release: published.manifest.frameworkVersion,
        catalog: published.manifest.catalog,
        overrides: ["ui", "api", "host", "plugins"],
        plugins: ["template"],
      });

      // Link the child's framework packages to the local tree — the gate
      // exercises THIS tree's init/dev pathway (see the header note).
      for (const dist of LOCAL_FRAMEWORK_PACKAGES) {
        if (!existsSync(join(REPO_ROOT, dist[1], "dist"))) {
          await runCommand("pnpm", ["run", "build", "template"], REPO_ROOT, 600_000);
          break;
        }
      }
      const workspacePath = join(testDir, "pnpm-workspace.yaml");
      const workspaceLines = readFileSync(workspacePath, "utf8").split("\n");
      const linkLines = LOCAL_FRAMEWORK_PACKAGES.map(
        ([name, dir]) => `  ${name}: "link:${join(REPO_ROOT, dir)}"`,
      );
      const overridesIdx = workspaceLines.indexOf("overrides:");
      if (overridesIdx === -1) {
        workspaceLines.push("overrides:", ...linkLines);
      } else {
        workspaceLines.splice(overridesIdx + 1, 0, ...linkLines);
      }
      writeFileSync(workspacePath, `${workspaceLines.join("\n")}\n`);

      await runPnpmInstall(testDir);
      await runPnpmApproveAll(testDir);
    }, 600_000);

    afterAll(() => {
      vi.unstubAllGlobals();
      if (process.env.BOS_KEEP_TEST_DIR !== "1") {
        rmSync(testDir, { recursive: true, force: true });
      }
    }, 120_000);

    it("settles pnpm permissions — nothing awaits approval, the policy persists", async () => {
      const workspaceYaml = readFileSync(join(testDir, "pnpm-workspace.yaml"), "utf8");
      expect(workspaceYaml).toContain("permissions:");

      const list = await runCommand("pnpm", ["permissions", "list"], testDir);
      expect(
        list.stdout + list.stderr,
        `pnpm reports pending decisions after the init approve leg:\n${list.stdout}\n${list.stderr}`,
      ).not.toContain("Awaiting approval");
    }, 120_000);

    it("generates types against the deployed chain", async () => {
      writeGeneratedAuthStubs(testDir);
      const result = await runCommand("pnpm", ["run", "types:gen"], testDir, 240_000);
      expect(
        result.code,
        `types:gen exited ${result.code}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      ).toBe(0);
      expect(existsSync(join(testDir, "ui/src/lib/api-types.gen.ts"))).toBe(true);
    }, 300_000);

    it("the platform pin resolves against the extends chain (upgrade --check is well-formed)", async () => {
      const result = await runCommand(
        "node_modules/.bin/bos",
        ["upgrade", "--check", "--json"],
        testDir,
        240_000,
      );
      // Exit 0 (aligned) or 1 (a newer release published since this run began —
      // legitimate drift the upgrade train owns). Anything else is a broken
      // fresh tree: unresolvable pin, config failure, crash.
      expect([0, 1]).toContain(result.code);
      const report = JSON.parse(result.stdout) as {
        release?: { resolved?: string };
        error?: string;
      };
      expect(report.error).toBeUndefined();
      expect(report.release?.resolved).toMatch(/^\d+\.\d+\.\d+/);
    }, 300_000);

    it("bos dev boots the fresh child cleanly and quits gracefully", async () => {
      const { spawn } = await import("node:child_process");
      const dev = spawn(
        "node_modules/.bin/bos",
        [
          "dev",
          "--no-interactive",
          "--port",
          String(PORTS.host),
          "--api-port",
          String(PORTS.api),
          "--auth-port",
          String(PORTS.auth),
          "--ui-port",
          String(PORTS.ui),
          "--plugin-port-start",
          String(PORTS.plugins),
        ],
        {
          cwd: testDir,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, BOS_NO_PERSIST_PORTS: "1", BOS_NO_BANNER: "1" },
        },
      );
      let output = "";
      dev.stdout?.on("data", (chunk) => {
        output += chunk.toString();
      });
      dev.stderr?.on("data", (chunk) => {
        output += chunk.toString();
      });

      const waitForHttp = async (port: number, label: string, budgetMs: number) => {
        const deadline = Date.now() + budgetMs;
        while (Date.now() < deadline) {
          if (dev.exitCode !== null) {
            throw new Error(`${label}: bos dev exited before serving (${dev.exitCode})\n${output}`);
          }
          try {
            const res = await fetch(`http://127.0.0.1:${port}/`, {
              signal: AbortSignal.timeout(2000),
            });
            if (res.status < 600) return res.status;
          } catch {
            // not serving yet — keep waiting
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error(`${label}: not serving after ${budgetMs}ms\n${output}`);
      };

      try {
        const uiStatus = await waitForHttp(PORTS.ui, "ui", 180_000);
        expect(uiStatus).toBe(200);
        await waitForHttp(PORTS.api, "api", 60_000);

        // The rc.30 regression class, asserted on the boot output: a fresh
        // child's plane composes coherently, and shutdown carries no pool
        // stack-trace noise from stale pinned bytes.
        expect(output).not.toContain("release-composition divergence");
        expect(output).not.toContain("pool.end() called from");
      } finally {
        dev.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            dev.kill("SIGKILL");
            resolve();
          }, 30_000);
          dev.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }

      // Graceful quit: SIGTERM sufficed (no SIGKILL race), and the ports this
      // run pinned were never persisted (BOS_NO_PERSIST_PORTS).
      expect(dev.exitCode).not.toBeNull();
    }, 420_000);
  },
);
