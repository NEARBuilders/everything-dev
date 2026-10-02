import { describe, expect, it } from "vitest";
import { registerBuild } from "../../src/commands/build";
import { registerConfig } from "../../src/commands/config";
import { registerDb } from "../../src/commands/db";
import { registerDeploy } from "../../src/commands/deploy";
import { registerDev } from "../../src/commands/dev";
import { registerInit } from "../../src/commands/init";
import { registerKeys } from "../../src/commands/keys";
import { registerOps } from "../../src/commands/ops";
import { registerPlugins } from "../../src/commands/plugins";
import type { BosBuilder } from "../../src/commands/shared";
import { registerUpgrade } from "../../src/commands/upgrade";
import { bosContract } from "../../src/contract";
import bosPlugin from "../../src/plugin";

const registerFns = [
  registerConfig,
  registerPlugins,
  registerDev,
  registerBuild,
  registerDeploy,
  registerKeys,
  registerInit,
  registerUpgrade,
  registerDb,
  registerOps,
];

function makeStubBuilder(records: Map<string, number>): BosBuilder {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop !== "string") return undefined;
        return {
          handler: (handler: unknown) => {
            records.set(prop, (records.get(prop) ?? 0) + 1);
            return { route: prop, handler };
          },
        };
      },
    },
  ) as BosBuilder;
}

describe("command module structure", () => {
  it("registers every contract route exactly once", () => {
    const records = new Map<string, number>();
    const builder = makeStubBuilder(records);
    const router = Object.assign({}, ...registerFns.map((register) => register(builder)));

    const contractRoutes = Object.keys(bosContract).sort();
    expect(contractRoutes.length).toBeGreaterThan(0);
    expect([...records.keys()].sort()).toEqual(contractRoutes);
    expect(Object.keys(router).sort()).toEqual(contractRoutes);
    for (const [route, count] of records) {
      expect(count, route).toBe(1);
    }
  });

  it("composer builds the full router through the real builder", () => {
    const router = new bosPlugin().createRouter({});
    expect(Object.keys(router).sort()).toEqual(Object.keys(bosContract).sort());
  });
});
