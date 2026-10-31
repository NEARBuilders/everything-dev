#!/usr/bin/env node
/**
 * Start-command regression stack (ADR 0009): builds the Dockerfile
 * `regression` fixture — the staged-dists harness image, not the deployable
 * `runtime` stage (ADR 0021) — and boots it with the regression test
 * databases. The fixture serves every dist on container-internal static
 * servers and boots the production host over them with a baked local config;
 * the full internal port range is mapped so the runner's browser can reach
 * those servers directly. No runner-side builds, no FastKV, no NEAR
 * credentials.
 *
 * Usage: node tests/regression/lib/start-container.mjs <ssr|csr>
 */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { computeRegressionEnv } from "./regression-env.mjs";

const variant = process.argv[2];
if (!["ssr", "csr"].includes(variant)) {
  console.error(`usage: start-container.mjs <ssr|csr> (got: ${variant ?? "nothing"})`);
  process.exit(1);
}

const log = (...lines) => console.log(`[start-container:${variant}]`, ...lines);
const regressionEnv = computeRegressionEnv();
const root = regressionEnv.repoRoot;
const basePort = regressionEnv.basePort;
const containerName = `bos-regression-${variant}-${process.pid}`;
const image = "bos-regression:local";

const run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`)),
    );
  });

const waitForDatabases = async () => {
  const deadline = Date.now() + 60_000;
  for (const url of Object.values(regressionEnv.dbUrls)) {
    // PGlite URLs (`.bos/db` data dirs, `:memory:`) are in-process — the
    // container's services boot their own database, nothing to probe here.
    try {
      const protocol = new URL(url).protocol;
      if (protocol !== "postgres:" && protocol !== "postgresql:") continue;
    } catch {
      // malformed URL — the stack will surface it
    }
    const parsed = new URL(url);
    let reachable = false;
    while (Date.now() < deadline && !reachable) {
      reachable = await new Promise((resolve) => {
        const connection = net.connect(Number(parsed.port), parsed.hostname);
        connection.setTimeout(2_000, () => connection.destroy());
        connection.once("connect", () => {
          connection.end();
          resolve(true);
        });
        connection.once("error", () => resolve(false));
        connection.once("close", () => resolve(false));
      });
      if (!reachable) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!reachable) throw new Error(`test database never became reachable: ${parsed.host}`);
  }
};

// Postgres URLs pointed at the runner reach the container through the docker
// host gateway; pglite URLs pass through untouched (the container boots its
// own in-process database).
const containerDbUrls = Object.fromEntries(
  Object.entries(regressionEnv.dbUrls).map(([key, url]) => [
    key,
    url.replace(/(127\.0\.0\.1|localhost)/, "host.docker.internal"),
  ]),
);

const childEnv = {
  ...containerDbUrls,
  BETTER_AUTH_SECRET: regressionEnv.authSecret,
  // The auth plugin's boot-time seeding seam — the HTTP helpers approve orgs
  // and set roles through the admin routes (ADR 0038 addendum).
  AUTH_BOOTSTRAP_ADMIN_API_KEY: regressionEnv.bootstrapAdminKey,
  BASE_URL: regressionEnv.baseUrl,
  CORS_ORIGIN: regressionEnv.baseUrl,
  REGRESSION_VARIANT: variant,
  // The Go harness tunes the host's rate-limit and body-limit middlewares for
  // the suite (regtest/process.go setIfUnset) — forward them; without them
  // the container's host runs middleware defaults and the body-limit and
  // rate-limit pins fail (no 413, no 429).
  RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS ?? "1000",
  RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? "100",
  BODY_LIMIT_MAX: process.env.BODY_LIMIT_MAX ?? "65536",
  // better-auth's internal limiter defaults on in production with a single
  // shared per-path bucket (no client IP behind the harness) — the suite's
  // /api/auth/* traffic trips it within seconds.
  BETTER_AUTH_RATE_LIMIT_DISABLED: "1",
  // The stack boots a staged fixture config — the boot config is the truth;
  // a mid-suite adopt of the live registry config swaps the module generation
  // under the running suite. The start stack disables the watch for
  // config-path boots itself; this passthrough makes it explicit and lets a
  // dev force an interval (BOS_SNAPSHOT_WATCH_INTERVAL_MS=30000) to exercise
  // the swap path.
  BOS_SNAPSHOT_WATCH_INTERVAL_MS: process.env.BOS_SNAPSHOT_WATCH_INTERVAL_MS ?? "0",
};

const dockerRemove = (args, note) => {
  const result = spawnSync("docker", ["rm", "-f", ...args], { stdio: "ignore" });
  if (result.status !== 0) {
    log(`${note} (docker rm -f exited ${result.status ?? "spawn-failure"})`);
  }
};

const reapStaleContainers = () => {
  const prefix = `bos-regression-${variant}-`;
  const ps = spawnSync("docker", ["ps", "-aq", "--filter", `name=${prefix}`], {
    encoding: "utf8",
  });
  const ids = (ps.stdout ?? "")
    .split("\n")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length > 0) {
    log(`reaping ${ids.length} stale ${prefix}* container(s) from prior runs`);
    dockerRemove(ids, "stale-container reap");
  }
};

const mappedRange = () => {
  const fallback = { range: [basePort, basePort + 20], containerBasePort: basePort };
  const result = spawnSync(
    "docker",
    ["run", "--rm", "--entrypoint", "cat", image, "/app/.bos/regression/image/layout.json"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    log(
      `could not read the staged layout (docker run exited ${result.status}) — mapping the fixed ${fallback.range[0]}-${fallback.range[1]} range`,
    );
    return fallback;
  }
  try {
    const layout = JSON.parse(result.stdout);
    const ports = [layout.basePort, ...layout.servers.map((server) => server.port)];
    const low = Math.min(...ports);
    const high = Math.max(...ports);
    if (!Number.isInteger(low) || !Number.isInteger(high) || high < low) {
      throw new Error("degenerate layout ports");
    }
    return { range: [low, high], containerBasePort: layout.basePort };
  } catch (error) {
    log(
      `unreadable staged layout (${error.message}) — mapping the fixed ${fallback.range[0]}-${fallback.range[1]} range`,
    );
    return fallback;
  }
};

const dockerRun = (range, containerBasePort) =>
  spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      containerName,
      // Map the whole in-container port map, not just the host port: the
      // runtime config embeds container-internal localhost URLs (ui, auth-ui,
      // host-dist, per-plugin) that the BROWSER on the runner must reach — a
      // host-port-only map leaves every page load hanging.
      "-p",
      `${range[0]}-${range[1]}:${range[0]}-${range[1]}`,
      // Container-internal ports are fixed (baked into the image) — when
      // REGRESSION_BASE_URL's port differs, the 1:1 map leaves /health
      // probing a port nothing answers; map the runner's port explicitly.
      ...portOverrides(range, containerBasePort).flatMap(([host, container]) => [
        "-p",
        `${host}:${container}`,
      ]),
      "--add-host=host.docker.internal:host-gateway",
      ...Object.entries(childEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      image,
    ],
    { stdio: "inherit" },
  );

function portOverrides(range, containerBasePort) {
  const runnerPort = regressionEnv.basePort;
  if (runnerPort === containerBasePort) return [];
  if (runnerPort >= range[0] && runnerPort <= range[1]) {
    console.error(
      `[start-container:${variant}] REGRESSION_BASE_URL port ${runnerPort} collides with the ` +
        `container's fixed port map ${range[0]}-${range[1]} — set REGRESSION_BASE_URL ` +
        `outside that block (e.g. :${range[1] + 1}) or restore the container base ${containerBasePort}`,
    );
    process.exit(1);
  }
  return [[runnerPort, containerBasePort]];
}

const main = async () => {
  await waitForDatabases();
  dockerRemove([containerName], "pre-run cleanup: nothing to remove");
  reapStaleContainers();

  const prebuilt = process.env.REGRESSION_PREBUILT_IMAGE;
  if (prebuilt) {
    // CI provides the fixture built once per run by the regression-image job
    // (digest-pinned ref pushed to GHCR); pulling beats rebuilding on an
    // ephemeral runner. Local runs (and CI fallback when the image job was
    // skipped or failed) keep the build path.
    log(`pulling the prebuilt regression image ${prebuilt}…`);
    await run("docker", ["pull", prebuilt]);
    await run("docker", ["tag", prebuilt, image]);
  } else {
    log(`building the deployment image (docker build --target regression)…`);
    await run("docker", ["build", "--target", "regression", "-t", image, "."]);
  }

  const { range, containerBasePort } = mappedRange();
  const child = dockerRun(range, containerBasePort);
  const teardown = () => {
    dockerRemove([containerName], "teardown: container already gone");
  };
  process.on("SIGTERM", teardown);
  process.on("SIGINT", teardown);
  process.on("exit", teardown);
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });

  const deadline = Date.now() + 240_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    if (child.exitCode !== null || child.signalCode !== null) {
      console.error(
        `[start-container:${variant}] container exited early (code ${child.exitCode}, signal ${child.signalCode}) — skipping the remaining health budget`,
      );
      break;
    }
    try {
      const res = await fetch(`${regressionEnv.baseUrl}/health`);
      ready = res.ok;
    } catch {
      /* not up yet */
    }
    if (!ready && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (!ready) {
    console.error(
      `[start-container:${variant}] stack never became healthy at ${regressionEnv.baseUrl}/health — pulling container logs`,
    );
    spawnSync(
      "docker",
      ["cp", `${containerName}:/app/.bos/logs`, path.join(root, ".bos", "logs")],
      { stdio: "inherit" },
    );
    teardown();
    process.exit(1);
  }
  log(`production stack (${variant}) ready at ${regressionEnv.baseUrl}`);
};

await main();
