import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { computeRegressionEnv, regressionStackOptions } from "./regression-env.mjs";

const roots = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "regression-config-"));
  roots.push(root);
  writeFileSync(
    join(root, "bos.config.json"),
    JSON.stringify({
      app: { api: { secrets: ["API_DATABASE_URL"] } },
      plugins: { auth: { development: "local:plugins/auth", secrets: ["AUTH_DATABASE_URL"] } },
    }),
  );
  writeFileSync(
    join(root, ".env"),
    "API_DATABASE_URL=postgres://dev:private@localhost:5432/dev\nBETTER_AUTH_SECRET=private-dev\n",
  );
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

void test("resolved test configuration owns child secrets and ports for every mode", () => {
  const repoRoot = fixture();
  writeFileSync(
    join(repoRoot, ".env.test"),
    [
      'export API_DATABASE_URL="postgres://test:test@localhost:5434/api_test" # test only',
      "AUTH_DATABASE_URL=postgres://test:test@localhost:5435/auth_test",
      'BETTER_AUTH_SECRET="test#secret"',
    ].join("\n"),
  );
  const env = {
    REGRESSION_BASE_URL: "http://localhost:5200",
    API_DATABASE_URL: "postgres://dev:private@localhost:5432/dev",
    BETTER_AUTH_SECRET: "private-dev",
    CUSTOM: "preserved",
  };
  const config = computeRegressionEnv({ repoRoot, env });
  assert.equal(config.basePort, 5200);
  assert.equal(config.stalePorts[0], 5200);
  assert.ok(config.stalePorts.includes(5210));
  for (const mode of ["dev:ssr", "dev:csr", "backcompat"]) {
    const stack = regressionStackOptions(config, mode, env);
    assert.equal(stack.env.API_DATABASE_URL, config.dbUrls.API_DATABASE_URL);
    assert.equal(stack.env.AUTH_DATABASE_URL, config.dbUrls.AUTH_DATABASE_URL);
    assert.equal(stack.env.BETTER_AUTH_SECRET, "test#secret");
    assert.equal(stack.env.CORS_ORIGIN, config.baseUrl);
    assert.equal(stack.env.CUSTOM, "preserved");
    assert.equal(stack.command[stack.command.indexOf("--port") + 1], "5200");
    assert.equal(stack.command[stack.command.indexOf("--plugin-port-start") + 1], "5210");
  }

  // start:* stacks boot through the deployment image, not a runner-side command.
  assert.throws(() => regressionStackOptions(config, "start:ssr", {}), /unknown mode/);
});

void test("ambient test settings reach the stack when no test file exists", () => {
  const repoRoot = fixture();
  const env = {
    API_DATABASE_URL: "postgres://test:test@localhost:5434/api_test",
    AUTH_DATABASE_URL: "postgres://test:test@localhost:5435/auth_test",
    BETTER_AUTH_SECRET: "test-secret",
  };
  const config = computeRegressionEnv({ repoRoot, env });
  const stack = regressionStackOptions(config, "dev:ssr", {});
  assert.equal(stack.env.API_DATABASE_URL, env.API_DATABASE_URL);
  assert.equal(stack.env.BETTER_AUTH_SECRET, env.BETTER_AUTH_SECRET);
});

void test("dev database rejection does not reveal credentials", () => {
  const repoRoot = fixture();
  assert.throws(
    () => computeRegressionEnv({ repoRoot, env: {} }),
    (error) => error.message.includes("dev database") && !error.message.includes("private"),
  );
});

void test("invalid modes fail before starting a stack", () => {
  assert.throws(() => regressionStackOptions({}, "invalid", {}), /unknown mode/);
});

void test("loading browser configuration in a worker leaves the running stack alive", async () => {
  const repoRoot = fixture();
  writeFileSync(join(repoRoot, "bos.config.json"), "{}");
  writeFileSync(join(repoRoot, ".env.test"), "BETTER_AUTH_SECRET=test-secret\n");
  const server = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    'import { createServer } from "node:http"; const server = createServer((_req, res) => res.end("alive")); server.listen(0, "127.0.0.1", () => console.log(server.address().port));',
  ]);
  const [output] = await once(server.stdout, "data");
  const baseUrl = `http://127.0.0.1:${Number(String(output).trim())}`;
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "await import(process.argv[1]);",
        new URL("../browser/playwright.config.mjs", import.meta.url).href,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, REGRESSION_BASE_URL: baseUrl },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await (await fetch(baseUrl)).text(), "alive");
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, "exit");
      server.kill();
      await stopped;
    }
  }
});
