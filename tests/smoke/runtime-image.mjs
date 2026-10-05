/**
 * Runtime-image smoke gate (ticket 02): boots the universal `runtime` image
 * the way production boots — identity from BOS_ACCOUNT/BOS_GATEWAY env, the
 * published config, staged bundles — and asserts the boot surface: /health,
 * one SSR page, the OpenAPI spec, `bos mf check` in-image, and prints the
 * image size. Plain Node, no dependencies; health/SSR/API polls run
 * concurrently against a shared boot deadline.
 *
 * Usage: node tests/smoke/runtime-image.mjs [--image <ref>] [--port <n>] [--keep]
 * Database URLs default to the local compose test databases on
 * host.docker.internal (the start-container idiom).
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const image = flag("--image") ?? "everything-dev-smoke:local";
const port = flag("--port") ?? "3000";
const keep = args.includes("--keep");
const baseUrl = `http://localhost:${port}`;
const container = `everything-dev-smoke-${process.pid}`;

const BOOT_DEADLINE_MS = 240_000;
const POLL_INTERVAL_MS = 1_000;

const envPairs = {
  BOS_ACCOUNT: process.env.SMOKE_BOS_ACCOUNT ?? "dev.everything.near",
  BOS_GATEWAY: process.env.SMOKE_BOS_GATEWAY ?? "everything.dev",
  API_DATABASE_URL:
    process.env.SMOKE_API_DATABASE_URL ??
    "postgres://everythingdev:everythingdev@host.docker.internal:5434/api_test_db",
  AUTH_DATABASE_URL:
    process.env.SMOKE_AUTH_DATABASE_URL ??
    "postgres://everythingdev:everythingdev@host.docker.internal:5435/auth_test_db",
  BETTER_AUTH_SECRET:
    process.env.SMOKE_BETTER_AUTH_SECRET ?? "smoke-test-secret-do-not-use-in-production",
};

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, { encoding: "utf8", ...opts });
  if (result.error) throw result.error;
  return result;
}

function docker(cmdArgs, opts = {}) {
  return run("docker", cmdArgs, opts);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bounded poll: resolves with the check's result once it passes, rejects at the deadline. */
async function pollUntil(name, check, deadlineMs = BOOT_DEADLINE_MS) {
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
      lastFailure = error?.message ?? String(error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${name} did not pass within the boot deadline — last failure: ${lastFailure}`);
}

async function fetchStatusOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response;
}

async function checkHealth() {
  const response = await fetchStatusOk(`${baseUrl}/health`);
  return `status ${response.status}`;
}

async function checkSsrPage() {
  const response = await fetchStatusOk(`${baseUrl}/`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error(`/ content-type ${contentType}`);
  const body = await response.text();
  if (!/<html/i.test(body)) throw new Error("/ did not return an HTML document");
  return `${body.length} bytes`;
}

async function checkApiSpec() {
  const response = await fetchStatusOk(`${baseUrl}/api/spec.json`);
  const spec = await response.json();
  if (!spec.openapi && !spec.paths) throw new Error("/api/spec.json is not an OpenAPI document");
  return `${Object.keys(spec.paths ?? {}).length} paths`;
}

async function checkMfCompat() {
  const result = docker(
    ["exec", container, "node", "./node_modules/everything-dev/dist/cli.mjs", "mf", "check"],
    { stdio: "pipe" },
  );
  if (result.status !== 0) {
    throw new Error(
      `bos mf check failed (exit ${result.status})\n${result.stdout}${result.stderr}`,
    );
  }
  return (result.stdout ?? "").trim().split("\n").at(-1) ?? "";
}

function printImageSize() {
  const result = docker(["image", "inspect", "-f", "{{.Size}}", image], { stdio: "pipe" });
  if (result.status !== 0) throw new Error(`image inspect failed: ${result.stderr}`);
  const bytes = Number(result.stdout.trim());
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  console.log(`  ℹ image size: ${mb} MB (${image})`);
  return `${mb} MB`;
}

async function main() {
  console.log(`smoke: building nothing — booting ${image} on :${port}`);
  const up = docker(
    [
      "run",
      "-d",
      "--name",
      container,
      "-p",
      `${port}:${port}`,
      "--add-host=host.docker.internal:host-gateway",
      ...Object.entries(envPairs).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      image,
    ],
    { stdio: "pipe" },
  );
  if (up.status !== 0) throw new Error(`docker run failed: ${up.stderr}`);

  try {
    const [health, ssr, api] = await Promise.all([
      pollUntil("health", checkHealth),
      pollUntil("ssr page", checkSsrPage),
      pollUntil("api spec", checkApiSpec),
    ]);
    console.log(`  ℹ health: ${health}; ssr: ${ssr}; api: ${api}`);

    console.log(`  … bos mf check (in-image)`);
    const mf = await pollUntil("bos mf check", checkMfCompat, 60_000);
    console.log(`  ✓ mf compat: ${mf}`);

    printImageSize();
    console.log("smoke: PASS");
  } catch (error) {
    console.error(`smoke: FAIL — ${error?.message ?? error}`);
    const logs = docker(["logs", "--tail", "80", container], { stdio: "pipe" });
    const output = `${logs.stdout ?? ""}${logs.stderr ?? ""}`;
    if (output.trim()) console.error(output);
    if (/pins no version manifest|redeploy required/i.test(output)) {
      console.error(
        "smoke: the published config predates version-manifest pins — run `bos deploy` to republish with pins; the smoke gate goes green after that",
      );
    }
    process.exitCode = 1;
  } finally {
    if (!keep) docker(["rm", "-f", container], { stdio: "pipe" });
    else console.log(`smoke: kept container ${container}`);
  }
}

const timeout = setTimeout(() => {
  console.error("smoke: global timeout — tearing down");
  docker(["rm", "-f", container], { stdio: "pipe" });
  process.exit(1);
}, BOOT_DEADLINE_MS * 2);
timeout.unref();

await main();
