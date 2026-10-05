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
    const parsed = new URL(url);
    let reachable = false;
    while (Date.now() < deadline && !reachable) {
      reachable = await new Promise((resolve) => {
        const connection = net.connect(Number(parsed.port), parsed.hostname);
        connection.once("connect", () => {
          connection.end();
          resolve(true);
        });
        connection.once("error", () => resolve(false));
      });
      if (!reachable) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!reachable) throw new Error(`test database never became reachable: ${parsed.host}`);
  }
};

// The test databases live on the runner; the container reaches them through
// the docker host gateway.
const containerDbUrls = Object.fromEntries(
  Object.entries(regressionEnv.dbUrls).map(([key, url]) => [
    key,
    url.replace(/(127\.0\.0\.1|localhost)/, "host.docker.internal"),
  ]),
);

const childEnv = {
  ...containerDbUrls,
  BETTER_AUTH_SECRET: regressionEnv.authSecret,
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
};

const dockerRun = () =>
  spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      containerName,
      // Map the whole in-container port map, not just the host port: the
      // runtime config embeds container-internal localhost URLs (ui 4103,
      // auth-ui 4104, host-dist 4105) that the BROWSER on the runner must
      // reach — a 4100-only map leaves every page load hanging.
      "-p",
      `${basePort}-${basePort + 20}:${basePort}-${basePort + 20}`,
      "--add-host=host.docker.internal:host-gateway",
      ...Object.entries(childEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      image,
    ],
    { stdio: "inherit" },
  );

const main = async () => {
  await waitForDatabases();
  try {
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
  } catch {
    /* nothing to clean */
  }

  log(`building the deployment image (docker build --target regression)…`);
  await run("docker", ["build", "--target", "regression", "-t", image, "."]);

  const child = dockerRun();
  const teardown = () => {
    try {
      spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
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
    try {
      const res = await fetch(`${regressionEnv.baseUrl}/health`);
      ready = res.ok;
    } catch {
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
