import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cause, Effect, Exit } from "effect";
import type { BosEnv } from "everything-dev/config";
import { afterEach, describe, expect, it } from "vitest";
import type { FederationError } from "../../src/services/errors";
import { waitForLocalContainer } from "../../src/services/federation/containers";
import { startLocalDistServer } from "../../src/services/local-dist-server";

const servers: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop();
});

const serveDist = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wait-container-"));
  const server = await startLocalDistServer(root);
  servers.push(server);
  return { root, server };
};

const entry = (ssrUrl: string): Parameters<typeof waitForLocalContainer>[0] => ({
  name: "ui",
  ssrUrl,
  containerVersion: "1234.5",
});

/** The dist layout the host's real container flow serves: the loopback
 * server roots at the dist dir and the SSR entry URL carries the `/ssr`
 * prefix. */
const ssrEntryUrlOf = (server: { baseUrl: string }) => `${server.baseUrl}/ssr`;

describe("waitForLocalContainer", () => {
  it("succeeds on the first poll when the loopback dist serves the container", async () => {
    const { root, server } = await serveDist();
    await mkdir(path.join(root, "ssr"), { recursive: true });
    await writeFile(path.join(root, "ssr", "remoteEntry.server.js"), "console.log('container')");

    const exit = await Effect.runPromiseExit(
      waitForLocalContainer(entry(ssrEntryUrlOf(server)), "development" as BosEnv),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("fails with the never-ready error when the container is missing", async () => {
    const { server } = await serveDist();

    const exit = await Effect.runPromiseExit(
      waitForLocalContainer(entry(ssrEntryUrlOf(server)), "development" as BosEnv, {
        timeoutMs: 400,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("unreachable");
    const error = Cause.squash(exit.cause) as FederationError;
    expect(error._tag).toBe("FederationError");
    expect(error.detail).toContain("never became ready");
  });

  it("honors a short recovery budget instead of the 120s cold-boot default", async () => {
    const { server } = await serveDist();
    const startedAt = Date.now();

    const exit = await Effect.runPromiseExit(
      waitForLocalContainer(entry(ssrEntryUrlOf(server)), "development" as BosEnv, {
        timeoutMs: 400,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it("fails immediately when the entry has no SSR URL — no local dist server", async () => {
    const exit = await Effect.runPromiseExit(
      waitForLocalContainer({ name: "ui", ssrUrl: undefined }, "development" as BosEnv),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("unreachable");
    const error = Cause.squash(exit.cause) as FederationError;
    expect(error.detail).toContain("no entry URL");
  });

  it("stops waiting once a mid-rebuild container reappears", async () => {
    const { root, server } = await serveDist();
    const containerPath = path.join(root, "ssr", "remoteEntry.server.js");

    const wait = Effect.runPromise(
      waitForLocalContainer(entry(ssrEntryUrlOf(server)), "development" as BosEnv, {
        timeoutMs: 10_000,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    await mkdir(path.join(root, "ssr"), { recursive: true });
    await writeFile(containerPath, "console.log('rebuilt')");
    await expect(wait).resolves.toBeUndefined();
  });
});
