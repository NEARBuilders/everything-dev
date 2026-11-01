import { describe, expect, it } from "vitest";

import { verifyBootPayload } from "../../src/services/resolution/boot-check";
import type { ResolutionIo } from "../../src/services/resolution/session";

/**
 * The publish boot-check's contract (the rc.23 gate regression): a leaf
 * payload is only the boot input when it carries no extends ref — consumer
 * boots parse the extends-merged shape (resolvePublishedConfig), so a
 * host-less child leaf must pass exactly when its merged shape parses.
 */

const parentWithHost = {
  account: "dev.everything.near",
  domain: "everything.dev",
  app: {
    host: {
      production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/host/",
    },
    ui: { production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/ui/" },
    api: {
      production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/api/",
    },
  },
};

const hostLessParent = {
  account: "dev.everything.near",
  domain: "everything.dev",
  app: {
    ui: { production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/ui/" },
    api: {
      production: "https://cdn.everything.dev/bundles/dev.everything.near/everything.dev/api/",
    },
  },
};

const hostLessChild = {
  account: "citynode.near",
  domain: "citynode.app",
  extends: "bos://dev.everything.near/everything.dev",
  app: {
    ui: { production: "https://cdn.everything.dev/bundles/citynode.near/citynode.app/ui/" },
    api: { production: "https://cdn.everything.dev/bundles/citynode.near/citynode.app/api/" },
  },
};

const rootPayload = {
  account: "dev.everything.near",
  domain: "everything.dev",
  app: { host: {}, ui: {}, api: {} },
};

const childSlot = { account: "citynode.near", gateway: "citynode.app" };
const parentRef = "bos://dev.everything.near/everything.dev";

const remoteIo = (remote: Record<string, unknown>): { io: ResolutionIo; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    io: {
      fetchBosConfig: async (url) => {
        calls.push(url);
        if (!(url in remote)) throw new Error(`No config found for ${url}`);
        return remote[url];
      },
      readFileOrNull: async () => {
        throw new Error("readFileOrNull must not be reached — the leaf is seeded");
      },
      importModule: async () => {
        throw new Error("importModule must not be reached by these fixtures");
      },
    },
  };
};

describe("verifyBootPayload", () => {
  it("a host-less child leaf boots via its parent's host — the rc.23 gate regression", async () => {
    const { io, calls } = remoteIo({ [parentRef]: parentWithHost });

    const report = await verifyBootPayload(hostLessChild, childSlot, { io });

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.chain).toEqual([parentRef]);
    expect(calls).toEqual([parentRef]);
  });

  it("a root payload parses as-is with zero I/O", async () => {
    const { io, calls } = remoteIo({});

    const report = await verifyBootPayload(
      rootPayload,
      {
        account: "dev.everything.near",
        gateway: "everything.dev",
      },
      { io },
    );

    expect(report.ok).toBe(true);
    expect(report.chain).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("an unreachable parent is a chain issue, not a throw", async () => {
    const { io } = remoteIo({});

    const report = await verifyBootPayload(hostLessChild, childSlot, { io });

    expect(report.ok).toBe(false);
    expect(report.chain).toEqual([]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      code: "chain",
      path: parentRef,
      origin: "parent",
    });
    expect(report.issues[0].message).toContain("could not be");
  });

  it("a child extending its own slot dies as a circular chain at check time", async () => {
    const { io } = remoteIo({});
    const selfExtending = { ...hostLessChild, extends: "bos://citynode.near/citynode.app" };

    const report = await verifyBootPayload(selfExtending, childSlot, { io });

    expect(report.ok).toBe(false);
    expect(report.issues[0]?.code).toBe("chain");
    expect(report.issues[0]?.message).toContain("circular");
  });

  it("a root payload missing app.ui is a schema issue attributed to the payload", async () => {
    const { io, calls } = remoteIo({});
    const missingUi = {
      account: "dev.everything.near",
      domain: "everything.dev",
      app: { host: {}, api: {} },
    };

    const report = await verifyBootPayload(
      missingUi,
      {
        account: "dev.everything.near",
        gateway: "everything.dev",
      },
      { io },
    );

    expect(report.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(report.issues[0]).toMatchObject({
      code: "schema",
      path: "app.ui",
      origin: "payload",
    });
  });

  it("a child whose merged shape still lacks app.host is attributed to the parent", async () => {
    const { io } = remoteIo({ [parentRef]: hostLessParent });

    const report = await verifyBootPayload(hostLessChild, childSlot, { io });

    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatchObject({
      code: "schema",
      path: "app.host",
      origin: "parent",
      message: expect.stringContaining("expected"),
    });
  });

  it("env-mapped extends resolves the production parent — the boot's env, not the checker's", async () => {
    const { io, calls } = remoteIo({
      "bos://prod.near/prod.app": parentWithHost,
    });
    const envMapped = {
      ...hostLessChild,
      extends: {
        production: "bos://prod.near/prod.app",
        development: "bos://dev.near/dev.app",
      },
    };

    const report = await verifyBootPayload(envMapped, childSlot, { io });

    expect(report.ok).toBe(true);
    expect(calls).toEqual(["bos://prod.near/prod.app"]);
  });

  it("never mutates the payload", async () => {
    const { io } = remoteIo({ [parentRef]: parentWithHost });
    const snapshot = structuredClone(hostLessChild);

    await verifyBootPayload(hostLessChild, childSlot, { io });

    expect(hostLessChild).toEqual(snapshot);
  });

  it("reports deterministic issues across runs", async () => {
    const ioA = remoteIo({ [parentRef]: hostLessParent }).io;
    const ioB = remoteIo({ [parentRef]: hostLessParent }).io;

    const [a, b] = await Promise.all([
      verifyBootPayload(hostLessChild, childSlot, { io: ioA }),
      verifyBootPayload(hostLessChild, childSlot, { io: ioB }),
    ]);

    expect(a.issues).toEqual(b.issues);
  });

  it("a non-object payload is a schema issue, not a crash", async () => {
    const { io, calls } = remoteIo({});

    const report = await verifyBootPayload(42, childSlot, { io });

    expect(report.ok).toBe(false);
    expect(calls).toEqual([]);
    expect(report.issues[0]).toMatchObject({ code: "schema", origin: "payload" });
  });
});
