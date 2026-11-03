import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildInitPatterns,
  copyFilteredFiles,
  personalizeConfig,
  runPnpmInstall,
} from "../../src/cli/init";
import {
  type ResolvedPlatformManifest,
  resolvePlatformManifest,
} from "../../src/services/platform/manifest";
import { runPnpmApproveAll } from "../../src/services/scaffold/init";
import { writeChildConfigFixture } from "../helpers/parent-config";
import { runCommand, writeGeneratedAuthStubs } from "./typecheck-utils";

/**
 * The consumer rc gate: the latest PUBLISHED release must scaffold a fresh
 * child the way `bos init` really does it — pin and catalog from the
 * published platform manifest, framework packages from npm — install
 * prompt-free (pnpm's permissions policy settled by the init approve leg),
 * resolve its pin against the extends chain, and BOOT under `bos dev`
 * cleanly: no release-plane divergence block, no shutdown noise, graceful
 * quit.
 *
 * This is the opencrosspost rc.30 failure class, end to end, against the
 * shipped artifact. Template-level logic (unreleased local changes) is
 * covered by init.full; this gate proves the rc itself works for the next
 * consumer, and goes red when the latest published rc doesn't.
 *
 * Runs only in CI: it installs the real published packages from npm and
 * resolves the real parent chain over the registry. The hermetic fetch
 * guard would otherwise block those in-process registry reads — the seam
 * is stubbed per the guard's protocol: the FastKV mainnet host passes
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

describe.skipIf(process.env.CI !== "true")(
  "fresh init — full dev run (the consumer rc gate)",
  () => {
    let testDir: string;
    let published: ResolvedPlatformManifest;

    beforeAll(async () => {
      vi.stubGlobal("fetch", registryPassthroughFetch);

      testDir = mkdtempSync(join(tmpdir(), "bos-fresh-init-dev-"));

      const patterns = buildInitPatterns(["ui", "api", "plugins"], ["template"], {
        template: "_template",
      });
      await copyFilteredFiles(REPO_ROOT, testDir, patterns, {
        overrides: ["ui", "api"],
        plugins: ["template"],
      });
      writeChildConfigFixture(testDir, ["ui", "api"], {
        template: { development: "local:plugins/_template" },
      });
      // A real scaffolded child declares its extends — the resolution walk
      // (and `bos dev`'s release-plane audit) read it from the config.
      const configPath = join(testDir, "bos.config.json");
      const fixture = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      fixture.extends = ROOT_EXTENDS;
      writeFileSync(configPath, JSON.stringify(fixture, null, 2));

      // The pin + catalog come from the published release — the real bos init
      // pathway (no local-tree catalog source).
      const localConfig = fixture;
      const resolved = await resolvePlatformManifest({ configDir: testDir, localConfig });
      if (!resolved) {
        throw new Error(
          "No platform release manifest publishes on the extends chain — the consumer rc gate needs a published release",
        );
      }
      published = resolved;

      await personalizeConfig(testDir, {
        extendsAccount: "dev.everything.near",
        extendsGateway: "everything.dev",
        account: "test.near",
        domain: "test.dev",
        platform: published.manifest.frameworkVersion,
        catalog: published.manifest.catalog,
        overrides: ["ui", "api", "plugins"],
        plugins: ["template"],
      });

      await runPnpmInstall(testDir);
      await runPnpmApproveAll(testDir);
    }, 600_000);

    afterAll(() => {
      vi.unstubAllGlobals();
      rmSync(testDir, { recursive: true, force: true });
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
        platform?: { resolved?: string };
        error?: string;
      };
      expect(report.error).toBeUndefined();
      expect(report.platform?.resolved).toMatch(/^\d+\.\d+\.\d+/);
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
        expect(output).not.toContain("release-plane divergence");
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
