#!/usr/bin/env node
/**
 * Regression stack lifecycle (ADR 0009 amendment): one owner module for the
 * start-command fixture container. Subcommands:
 *
 *   cleanup <ssr|csr>    rm -f every `bos-regression-<variant>-*` container,
 *                        any stamp. Runs BEFORE Playwright probes the URL so
 *                        a stale older-stamp stack can never be silently
 *                        reused (Playwright probes `webServer.url` before it
 *                        executes the webServer command).
 *   ensure <ssr|csr>     reap other-stamp stacks, reuse a healthy same-stamp
 *                        stack or build + boot a detached container stamped
 *                        with the current code state, wait for /health, exit
 *                        0. The container keeps running — the consumer polls
 *                        the URL; teardown is either the consumer's global
 *                        teardown (Playwright) or the next run's cleanup.
 *   teardown <ssr|csr>   rm -f the current-stamp container. Wired as the
 *                        browser suite's global teardown so a graceful run
 *                        always ends with the stack down.
 *   watch <ssr|csr>      hold the caller's webServer process: tail the
 *                        detached container's logs, exit non-zero when the
 *                        container dies, remove it on SIGTERM/SIGINT. Chained
 *                        after ensure by the regression:start:* scripts.
 *
 * The container name and image tag both embed the stamp from
 * regression-stack-core.mjs. Re-runs against unchanged code reuse the
 * already-healthy stack instead of rebuilding; changed code reaps and
 * rebuilds. The boot is `docker run -d` regardless: a SIGKILLed webServer
 * child orphans no live foreground docker process — the detached container
 * is either reused (same stamp) or reaped (other stamp).
 */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { computeRegressionEnv } from "./regression-env.mjs";
import { computeStamp, reapPlan, stackName } from "./regression-stack-core.mjs";

const usage = `usage: regression-stack.mjs <ensure|cleanup|teardown|watch> <ssr|csr>`;
const mode = process.argv[2];
const variant = process.argv[3];
if (
  !["ensure", "cleanup", "teardown", "watch"].includes(mode) ||
  !["ssr", "csr"].includes(variant)
) {
  console.error(usage);
  process.exit(1);
}

const log = (...lines) => console.log(`[regression-stack:${variant}:${mode}]`, ...lines);
const regressionEnv = computeRegressionEnv();
const root = regressionEnv.repoRoot;
const prefix = `bos-regression-${variant}-`;

const run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`)),
    );
  });

const gitFileHash = (relative) => {
  const result = spawnSync("git", ["-C", root, "hash-object", relative], { encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "").trim() : `missing:${relative}`;
};

const currentEnvPacket = () =>
  JSON.stringify({
    basePort: regressionEnv.basePort,
    dbUrls: regressionEnv.dbUrls,
  });

const gitParts = () => {
  const rev = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  const headSha = rev.status === 0 ? (rev.stdout ?? "").trim() : "no-repo";
  const gitDiff = spawnSync("git", ["-C", root, "diff", "HEAD"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const diff = gitDiff.status === 0 ? (gitDiff.stdout ?? "") : "";
  // Untracked fixtures (new files) ride the docker context but not `git diff
  // HEAD` — their presence re-stamps via the porcelain listing.
  const status = spawnSync("git", ["-C", root, "status", "--porcelain"], {
    encoding: "utf8",
  });
  const porcelain = status.status === 0 ? (status.stdout ?? "") : "";
  return { headSha, diff, porcelain };
};

const listContainers = () => {
  const ps = spawnSync(
    "docker",
    ["ps", "-a", "--format", "{{.Names}}", "--filter", `name=${prefix}`],
    {
      encoding: "utf8",
    },
  );
  return (ps.stdout ?? "")
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
};

const removeContainers = (names) => {
  for (const name of names) {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  }
};

const probeHealth = async (deadlineMs) => {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${regressionEnv.baseUrl}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
};

const waitForDatabases = async () => {
  const deadline = Date.now() + 60_000;
  for (const url of Object.values(regressionEnv.dbUrls)) {
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

const containerEnv = () => {
  const containerDbUrls = Object.fromEntries(
    Object.entries(regressionEnv.dbUrls).map(([key, url]) => [
      key,
      url.replace(/(127\.0\.0\.1|localhost)/, "host.docker.internal"),
    ]),
  );
  return {
    ...containerDbUrls,
    BETTER_AUTH_SECRET: regressionEnv.authSecret,
    BASE_URL: regressionEnv.baseUrl,
    CORS_ORIGIN: regressionEnv.baseUrl,
    REGRESSION_VARIANT: variant,
    RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS ?? "1000",
    RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX ?? "100",
    BODY_LIMIT_MAX: process.env.BODY_LIMIT_MAX ?? "65536",
    BETTER_AUTH_RATE_LIMIT_DISABLED: "1",
    BOS_SNAPSHOT_WATCH_INTERVAL_MS: process.env.BOS_SNAPSHOT_WATCH_INTERVAL_MS ?? "0",
  };
};

const mappedRange = (image) => {
  const fallback = [regressionEnv.basePort, regressionEnv.basePort + 20];
  const cat = spawnSync(
    "docker",
    ["run", "--rm", "--entrypoint", "cat", image, "/app/.bos/regression/image/layout.json"],
    { encoding: "utf8" },
  );
  if (cat.status !== 0) {
    log(
      `could not read the staged layout (docker run exited ${cat.status}) — mapping the fixed ${fallback[0]}-${fallback[1]} range`,
    );
    return fallback;
  }
  try {
    const layout = JSON.parse(cat.stdout);
    const ports = [layout.basePort, ...layout.servers.map((server) => server.port)];
    const low = Math.min(...ports);
    const high = Math.max(...ports);
    if (!Number.isInteger(low) || !Number.isInteger(high) || high < low) {
      throw new Error("degenerate layout ports");
    }
    return [low, high];
  } catch (error) {
    log(
      `unreadable staged layout (${error.message}) — mapping the fixed ${fallback[0]}-${fallback[1]} range`,
    );
    return fallback;
  }
};

const cleanup = async () => {
  const names = listContainers();
  removeContainers(names);
  log(`cleanup complete (${names.length} ${prefix}* container(s) removed)`);
};

const ensure = async () => {
  const stamp = computeStamp(await stampInputs());
  const name = stackName(variant, stamp);
  const image = `bos-regression-${variant}:${stamp.slice(0, 8)}`;
  log(`stamp ${stamp.slice(0, 8)}`);

  const names = listContainers();
  const exact = stackName(variant, stamp);
  const exactHealthy = await probeHealth(names.includes(exact) ? 5_000 : 0);
  const { keep, reap } = reapPlan(
    variant,
    stamp,
    names.map((n) => ({ name: n, healthy: n === exact && exactHealthy })),
  );
  if (reap.length > 0) {
    removeContainers(reap.map((c) => c.name));
    log(`reaped ${reap.length} container(s)`);
  }
  if (keep.length > 0) {
    log(`healthy same-stamp stack reused at ${regressionEnv.baseUrl} (${exact})`);
    return;
  }
  log(
    exactHealthy
      ? `same-stamp stack was not healthy — rebuilding`
      : `no same-stamp stack — building`,
  );

  await waitForDatabases();

  log(`building the fixture image (docker build --target regression)…`);
  await run("docker", ["build", "--target", "regression", "-t", image, "."]);

  const range = mappedRange(image);
  const env = containerEnv();
  const result = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      name,
      "--label",
      `bos.regression.variant=${variant}`,
      "--label",
      `bos.regression.stamp=${stamp.slice(0, 8)}`,
      "-p",
      `${range[0]}-${range[1]}:${range[0]}-${range[1]}`,
      "--add-host=host.docker.internal:host-gateway",
      ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      image,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(`[regression-stack:${variant}] docker run exited ${result.status}`);
    process.exit(1);
  }
  log(`container ${name} detached (image ${image}, ports ${range[0]}-${range[1]})`);

  const healthy = await probeHealth(240_000);
  if (!healthy) {
    console.error(
      `[regression-stack:${variant}] stack never became healthy at ${regressionEnv.baseUrl}/health — pulling container logs`,
    );
    spawnSync("docker", ["cp", `${name}:/app/.bos/logs`, path.join(root, ".bos", "logs")], {
      stdio: "inherit",
    });
    removeContainers([name]);
    process.exit(1);
  }
  log(`production stack (${variant}) ready and detached at ${regressionEnv.baseUrl}`);
};

const stampInputs = async () => {
  const { headSha, diff, porcelain } = gitParts();
  return {
    headSha,
    diff: `${diff}\n${porcelain}`,
    dockerfile: gitFileHash("Dockerfile"),
    compose: gitFileHash("docker-compose.yml"),
    lockfile: gitFileHash("pnpm-lock.yaml"),
    environment: currentEnvPacket(),
  };
};

const teardown = async () => {
  const stamp = computeStamp(await stampInputs());
  const name = stackName(variant, stamp);
  removeContainers([name]);
  log(`teardown complete (${name})`);
};

/**
 * Watch mode: keep the calling harness's webServer process alive. Playwright
 * treats a webServer command that exits before teardown as a boot failure
 * even when the stack is already healthy, so the regression:start:*
 * scripts run `ensure` then hold with this command: tail the detached
 * container's logs, exit non-zero if the container dies mid-suite, and
 * remove it on the teardown signals — a graceful end leaves the stack down;
 * a SIGKILLed caller leaves the healthy detached container behind, which
 * the next ensure reuses or reaps.
 */
const watch = async () => {
  const stamp = computeStamp(await stampInputs());
  const name = stackName(variant, stamp);
  const tail = spawn("docker", ["logs", "-f", "--tail", "100", name], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  const teardownOnSignal = () => {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
    tail.kill("SIGKILL");
    process.exit(0);
  };
  process.on("SIGTERM", teardownOnSignal);
  process.on("SIGINT", teardownOnSignal);
  tail.on("exit", () => process.exit(1));
};

if (mode === "cleanup") await cleanup();
else if (mode === "ensure") await ensure();
else if (mode === "watch") await watch();
else await teardown();
