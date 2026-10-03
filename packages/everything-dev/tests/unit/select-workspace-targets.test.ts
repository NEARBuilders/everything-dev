import { describe, expect, it } from "vitest";
import { selectWorkspaceTargets } from "../../src/build";

describe('selectWorkspaceTargets "local"', () => {
  it("returns only keys whose app.development starts with local:", () => {
    const cfg = {
      account: "x",
      app: {
        host: { development: "local:host" },
        ui: { development: "https://cdn.example/ui" },
        api: { development: "local:api" },
        auth: { development: "bos://auth.everything.near/auth" },
      },
      plugins: {},
    } as any;

    const result = selectWorkspaceTargets("local", cfg);
    expect(result).toEqual(["host", "api"]);
  });

  it("returns only keys whose plugins.<id>.development starts with local:", () => {
    const cfg = {
      account: "x",
      app: { host: { development: "https://cdn.example/host" } },
      plugins: {
        apps: { development: "local:plugins/apps" },
        proposals: { development: "https://cdn.example/proposals" },
        votes: { development: "local:plugins/votes" },
      },
    } as any;

    const result = selectWorkspaceTargets("local", cfg);
    expect(result.toSorted()).toEqual(["apps", "votes"].toSorted());
  });

  it("mixes app.local plus local plugins and skips remote-only entries", () => {
    const cfg = {
      account: "x",
      app: {
        host: { development: "local:host" },
        ui: {},
        api: { development: "local:api" },
      },
      plugins: {
        remoteOnly: { production: "https://cdn.example/ro" },
        localOne: { development: "local:plugins/local-one" },
      },
    } as any;

    const result = selectWorkspaceTargets("local", cfg);
    expect(result.toSorted()).toEqual(["api", "host", "localOne"].toSorted());
  });

  it("returns [] when nothing is local", () => {
    const cfg = {
      account: "x",
      app: { host: { production: "https://h" }, ui: {}, api: { production: "https://a" } },
      plugins: { remote: { production: "https://r" } },
    } as any;

    expect(selectWorkspaceTargets("local", cfg)).toEqual([]);
  });

  it("treats string-shorthand app entries as remote (stringified URL, no object.development)", () => {
    const cfg = {
      account: "x",
      app: {
        host: { development: "local:host" },
        auth: "https://cdn.example/auth",
      },
      plugins: {},
    } as any;

    const result = selectWorkspaceTargets("local", cfg);
    expect(result).toEqual(["host"]);
  });

  it('"all" still returns every key (back-compat)', () => {
    const cfg = {
      account: "x",
      app: { host: { development: "local:host" }, ui: {}, api: { development: "local:api" } },
      plugins: { apps: { development: "local:p" } },
    } as any;

    expect(selectWorkspaceTargets("all", cfg)).toEqual(["host", "ui", "api", "apps"]);
  });

  it("explicit csv list still filters to configured keys (back-compat)", () => {
    const cfg = {
      account: "x",
      app: { host: {}, ui: {}, api: {} },
      plugins: {},
    } as any;

    expect(selectWorkspaceTargets("host,ghost", cfg)).toEqual(["host"]);
  });
});
