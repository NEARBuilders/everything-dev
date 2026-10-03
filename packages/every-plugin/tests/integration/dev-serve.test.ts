import { spawn } from "node:child_process";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const FIXTURE_DIR = path.join(__dirname, "../fixtures/test-plugin");
const SERVE_PORT = 4123;
const BASE = `http://localhost:${SERVE_PORT}`;

let child: ReturnType<typeof spawn> | null = null;

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for condition");
}

describe("every-plugin standalone dev server", () => {
  afterAll(async () => {
    if (child && child.exitCode === null) child.kill("SIGTERM");
  });

  it("serves health, static bundle, and oRPC endpoints", async () => {
    child = spawn("bun", [path.join(__dirname, "../../bin/every-plugin-serve.mjs")], {
      cwd: FIXTURE_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(SERVE_PORT) },
    });
    child.on("error", (e) => console.error("[spawn error]", e));
    child.stdout?.on("data", (d) => process.stdout.write(`[serve] ${d}`));
    child.stderr?.on("data", (d) => process.stderr.write(`[serve!] ${d}`));

    await waitFor(async () => (await fetch(`${BASE}/health`)).ok);

    const health = await (await fetch(`${BASE}/health`)).text();
    expect(health).toBe("OK");

    await waitFor(async () => {
      const res = await fetch(`${BASE}/remoteEntry.js`, { method: "HEAD" });
      return res.ok;
    });

    const mfManifestRes = await fetch(`${BASE}/mf-manifest.json`);
    expect(mfManifestRes.ok).toBe(true);
    const mfManifest = (await mfManifestRes.json()) as { metaData?: { name?: string } };
    expect(mfManifest.metaData?.name).toBe("test-plugin");

    await waitFor(async () => {
      const res = await fetch(`${BASE}/`);
      const body = (await res.json()) as { status?: string };
      return body.status === "ready";
    });

    const docsRes = await fetch(`${BASE}/api`);
    expect(docsRes.ok).toBe(true);
    expect(await docsRes.text()).toContain("<!doctype");

    const specRes = await fetch(`${BASE}/api/spec.json`);
    expect(specRes.ok).toBe(true);
    const spec = (await specRes.json()) as { openapi?: string };
    expect(spec.openapi).toBe("3.1.1");

    const rpcRes = await fetch(`${BASE}/api/rpc/ping`, { method: "POST" });
    expect(rpcRes.ok).toBe(true);
  });
});
