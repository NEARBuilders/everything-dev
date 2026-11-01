import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/**
 * The runtime-image boot gate: boots a runtime image the way production
 * boots — identity from BOS_ACCOUNT/BOS_GATEWAY env and the published config
 * from the registry — and asserts the boot surface: /health, one SSR page,
 * the OpenAPI spec, and `bos mf check` in-image. Health/SSR/API polls run
 * concurrently against a shared boot deadline; a container that exits early
 * fails fast (the start stack exits non-zero when a service fails to boot),
 * and the failure path probes the CDN from inside the container to classify
 * network-class vs app-class boot failures before stopping gracefully (the
 * dev-session finalizer flushes its pending log lines on SIGTERM) and
 * capturing the full container stdout and session logs to `.bos/logs/smoke`.
 *
 * As the post-publish leg of `bos deploy --smoke`, this is the lockstep gate
 * between the published config and the Railway promotion: an image that
 * cannot boot against its own bundles never reaches production.
 */

export interface SmokeOptions {
  /** Runtime image ref to boot — required. */
  readonly image: string;
  /** Host port to publish the container on (default 3000). */
  readonly port?: number;
  /** Keep the container after the run (debugging). */
  readonly keep?: boolean;
  /** Registry identity the image boots under (defaults to the dev-everything identity). */
  readonly account?: string;
  readonly gateway?: string;
  readonly apiDatabaseUrl?: string;
  readonly authDatabaseUrl?: string;
  readonly authSecret?: string;
}

export interface SmokeResult {
  readonly ok: boolean;
  readonly image: string;
  /** One-line boot-surface summary on success. */
  readonly summary?: string;
  /** The failure classification from the in-container CDN probe. */
  readonly diagnosis?: string;
  readonly error?: string;
}

const BOOT_DEADLINE_MS = 240_000;
const POLL_INTERVAL_MS = 1_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: readonly string[]): RunResult {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const docker = (args: readonly string[]): RunResult => run("docker", args);

async function fetchStatusOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response;
}

/** Bounded poll: resolves with the check's result once it passes, rejects at the deadline. */
async function pollUntil<T>(
  name: string,
  check: () => Promise<T>,
  deadlineMs = BOOT_DEADLINE_MS,
): Promise<T> {
  const deadline = Date.now() + deadlineMs;
  let lastFailure = "no attempt";
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const detail = await check();
      console.log(`  ✓ ${name} (attempt ${attempt})`);
      return detail;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${name} did not pass within the boot deadline — last failure: ${lastFailure}`);
}

/** Resolves "exited" once the boot container has exited — the start stack
 * exits non-zero when a service fails to boot, so a dead container means the
 * remaining pollUntil time would be wasted polling nothing. Resolves
 * undefined when aborted. */
function watchContainerExit(container: string): {
  done: Promise<"exited" | undefined>;
  abort: () => void;
} {
  const controller = { aborted: false };
  const done = (async () => {
    while (!controller.aborted) {
      const state = docker(["inspect", "-f", "{{.State.Running}}", container]);
      if ((state.stdout ?? "").trim() === "false") return "exited" as const;
      await sleep(2_000);
    }
    return undefined;
  })();
  return { done, abort: () => (controller.aborted = true) };
}

/** While the container is still running, probe the CDN from inside it — a
 * boot failure on :3000 is either the CDN edge (network-class: unreachable,
 * 429/5xx, challenge) or a boot bug (module eval, shared-dependency skew,
 * server start), and the two need opposite fixes. Falls back to a one-off
 * container from the same image (equivalent network class) when the boot
 * container already exited. */
function probeCdnFromContainer(
  container: string,
  image: string,
  account: string,
  gateway: string,
): string {
  const cdnBase = process.env.SMOKE_CDN_BASE ?? "https://cdn.everything.dev";
  const base = `${cdnBase}/bundles/${account}/${gateway}/host`;
  const script = `
const base = ${JSON.stringify(base)};
(async () => {
  const urls = [base + "/mf-manifest.json"];
  try {
    const manifest = await fetch(urls[0]).then((r) => (r.ok ? r.json() : null));
    const expose = manifest?.exposes?.[0] ?? {};
    const files = expose.assets?.js?.sync ?? expose.files?.js?.sync ?? [];
    for (const f of files.slice(0, 3)) urls.push(base + "/" + f);
  } catch {}
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
      console.log("probe " + url + " -> " + res.status + (bytes ? " " + bytes + "B" : ""));
    } catch (error) {
      console.log("probe " + url + " -> FETCH_FAILED " + String(error));
    }
  }
})();
`;
  let probe = docker(["exec", container, "node", "-e", script]);
  if (probe.status !== 0) {
    probe = docker(["run", "--rm", image, "node", "-e", script]);
  }
  const output = `${probe.stdout}${probe.stderr}`.trim();
  console.error("--- in-container CDN probe ---");
  if (output) console.error(output);
  else console.error(`(no output — probe exit ${probe.status}: ${probe.stderr.trim()})`);
  const verdicts = output
    .split("\n")
    .filter((line) => line.startsWith("probe "))
    .map((line) => {
      const status = line.split(" -> ")[1] ?? "";
      if (status.startsWith("FETCH_FAILED")) return "unreachable";
      const code = Number.parseInt(status, 10);
      if (code === 200) return "ok";
      return "edge-error";
    });
  return verdicts.length === 0
    ? "probe did not run — see probe exit above"
    : verdicts.every((v) => v === "ok")
      ? "CDN reachable from inside the container — app-class boot failure; the cause is in the captured logs, not the network"
      : verdicts.some((v) => v === "unreachable")
        ? "CDN unreachable from inside the container — network-class failure (runner egress or CDN edge)"
        : "CDN answered non-200 from inside the container — edge or published-config mismatch (see statuses above)";
}

/** Copy the stack's .bos/logs out of the container (into the CI artifact
 * path) and capture the full container stdout — the failure reason for a
 * failed service only exists inside the container, which otherwise gets
 * deleted, and a tail window can cut the error behind spinner output. */
function captureContainerLogs(container: string, dockerLogs: string[]): void {
  const target = join(".bos", "logs", "smoke");
  mkdirSync(target, { recursive: true });
  const cp = docker(["cp", `${container}:/app/.bos/logs/.`, target]);
  if (cp.status !== 0) {
    console.error(`smoke: could not copy container logs: ${cp.stderr.trim()}`);
  } else {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    for (const file of walk(target)) {
      if (!file.endsWith(".log")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      console.error(`--- ${file} (last 60 of ${lines.length} lines) ---`);
      console.error(lines.slice(-60).join("\n"));
    }
  }
  writeFileSync(join(target, "smoke-stdout.log"), dockerLogs.join("\n"));
  console.error(
    `--- container stdout (full, ${dockerLogs.length} lines) → ${target}/smoke-stdout.log ---`,
  );
  console.error(dockerLogs.slice(-100).join("\n"));
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const port = options.port ?? 3000;
  const keep = options.keep ?? false;
  const baseUrl = `http://localhost:${port}`;
  const container = `everything-dev-smoke-${process.pid}`;
  const image = options.image;

  const envPairs: Record<string, string> = {
    BOS_ACCOUNT: options.account ?? process.env.SMOKE_BOS_ACCOUNT ?? "dev.everything.near",
    BOS_GATEWAY: options.gateway ?? process.env.SMOKE_BOS_GATEWAY ?? "everything.dev",
    // Boot-gate only: the container's own persistent-by-path PGlite default
    // (in-container fs) is enough — no external postgres involved.
    API_DATABASE_URL:
      options.apiDatabaseUrl ?? process.env.SMOKE_API_DATABASE_URL ?? "pglite:.bos/db",
    AUTH_DATABASE_URL:
      options.authDatabaseUrl ?? process.env.SMOKE_AUTH_DATABASE_URL ?? "pglite:.bos/db",
    BETTER_AUTH_SECRET:
      options.authSecret ??
      process.env.SMOKE_BETTER_AUTH_SECRET ??
      "smoke-test-secret-do-not-use-in-production",
  };

  const up = docker([
    "run",
    "-d",
    "--name",
    container,
    "-p",
    `${port}:${port}`,
    ...Object.entries(envPairs).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    image,
  ]);
  if (up.status !== 0) {
    return { ok: false, image, error: `docker run failed: ${up.stderr.trim()}` };
  }

  try {
    const exitWatch = watchContainerExit(container);
    const bootChecks = Promise.all([
      pollUntil("health", () =>
        fetchStatusOk(`${baseUrl}/health`).then((r) => `status ${r.status}`),
      ),
      pollUntil("ssr page", async () => {
        const response = await fetchStatusOk(`${baseUrl}/`);
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html")) throw new Error(`/ content-type ${contentType}`);
        const body = await response.text();
        if (!/<html/i.test(body)) throw new Error("/ did not return an HTML document");
        // The host falls back to the client shell — status 200, valid HTML —
        // when the server render throws. Only the SSR-attempted-and-failed
        // path renders this marker (no-SSR deployments serve the shell
        // without it), so its presence is a red smoke on any deployment
        // that promises SSR.
        if (body.includes("SSR unavailable")) {
          throw new Error("/ served the client-shell fallback — the server render failed");
        }
        return `${body.length} bytes`;
      }),
      pollUntil("api spec", async () => {
        const response = await fetchStatusOk(`${baseUrl}/api/spec.json`);
        const spec = (await response.json()) as { openapi?: unknown; paths?: unknown };
        if (!spec.openapi && !spec.paths) {
          throw new Error("/api/spec.json is not an OpenAPI document");
        }
        return `${Object.keys((spec.paths as Record<string, unknown>) ?? {}).length} paths`;
      }),
    ]);
    bootChecks.catch(() => {});
    const outcome = await Promise.race([bootChecks.then(() => "ready"), exitWatch.done]).finally(
      () => exitWatch.abort(),
    );
    if (outcome === "exited") {
      throw new Error(
        "boot container exited — a service failed to start (the cause is in the captured logs below)",
      );
    }
    const [health, ssr, api] = await bootChecks;
    console.log(`  ℹ health: ${health}; ssr: ${ssr}; api: ${api}`);

    console.log(`  … bos mf check (in-image)`);
    const mf = await pollUntil(
      "bos mf check",
      async () => {
        const result = docker([
          "exec",
          container,
          "node",
          "./node_modules/everything-dev/dist/cli.mjs",
          "mf",
          "check",
        ]);
        if (result.status !== 0) {
          throw new Error(
            `bos mf check failed (exit ${result.status})\n${result.stdout}${result.stderr}`,
          );
        }
        return (result.stdout.trim().split("\n").at(-1) ?? "").slice(0, 400);
      },
      60_000,
    );

    // ADR 0034: the boot gate also self-describes — the in-image platform
    // release manifest must exist and parse (the release contract ships in
    // the same bytes the host boots from).
    console.log(`  … platform manifest (in-image)`);
    const platformResult = docker([
      "exec",
      container,
      "node",
      "-e",
      `const m = JSON.parse(require('fs').readFileSync('./packages/everything-dev/dist/platform-manifest.json','utf8')); if (m.kind !== 'everything-dev/platform-manifest' || !m.frameworkVersion) process.exit(1); console.log(m.frameworkVersion)`,
    ]);
    if (platformResult.status !== 0) {
      throw new Error(
        `in-image platform manifest missing or invalid — the image was not built with the release contract (ADR 0034)\n${platformResult.stdout}${platformResult.stderr}`,
      );
    }
    const platformVersion = platformResult.stdout.trim();

    const sizeResult = docker(["image", "inspect", "-f", "{{.Size}}", image]);
    if (sizeResult.status !== 0) throw new Error(`image inspect failed: ${sizeResult.stderr}`);
    const mb = (Number(sizeResult.stdout.trim()) / (1024 * 1024)).toFixed(1);
    console.log(`  ℹ image size: ${mb} MB (${image})`);

    const summary = `health: ${health}; ssr: ${ssr}; api: ${api}; mf compat: ${mf}; platform: ${platformVersion}`;
    console.log("smoke: PASS");
    return { ok: true, image, summary };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    console.error(`smoke: FAIL — ${failure}`);
    const diagnosis = probeCdnFromContainer(
      container,
      image,
      envPairs.BOS_ACCOUNT,
      envPairs.BOS_GATEWAY,
    );
    console.error(`smoke diagnosis: ${diagnosis}`);
    const stop = docker(["stop", "-t", "15", container]);
    if (stop.status !== 0) {
      console.error(`smoke: graceful stop failed — ${stop.stderr.trim()}`);
    }
    const logs = docker(["logs", container]);
    captureContainerLogs(container, `${logs.stdout}${logs.stderr}`.split("\n"));
    if (/pins no version manifest|redeploy required/i.test(`${logs.stdout}${logs.stderr}`)) {
      console.error(
        "smoke: the published config predates version-manifest pins — run `bos deploy` to republish with pins; the smoke gate goes green after that",
      );
    }
    return { ok: false, image, diagnosis, error: failure };
  } finally {
    if (!keep) docker(["rm", "-f", container]);
    else console.log(`smoke: kept container ${container}`);
  }
}
