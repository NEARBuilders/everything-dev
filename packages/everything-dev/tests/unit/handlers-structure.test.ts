import { describe, expect, it } from "vitest";
import { bosContract } from "../../src/contract";
import { registerBuild } from "../../src/handlers/build";
import { registerConfig } from "../../src/handlers/config";
import { registerDb } from "../../src/handlers/db";
import { registerDeploy } from "../../src/handlers/deploy";
import { registerDev } from "../../src/handlers/dev";
import { registerImport } from "../../src/handlers/import";
import { registerInit } from "../../src/handlers/init";
import { registerKeys } from "../../src/handlers/keys";
import { registerSecrets } from "../../src/handlers/secrets";
import { registerOps } from "../../src/handlers/ops";
import { registerPlugins } from "../../src/handlers/plugins";
import { registerProcesses } from "../../src/handlers/processes";
import type { BosBuilder } from "../../src/handlers/shared";
import { registerSmoke } from "../../src/handlers/smoke";
import { registerUpgrade } from "../../src/handlers/upgrade";
import bosPlugin from "../../src/plugin";

const registerFns = [
  registerConfig,
  registerPlugins,
  registerDev,
  registerBuild,
  registerDeploy,
  registerSmoke,
  registerKeys,
  registerSecrets,
  registerProcesses,
  registerInit,
  registerImport,
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
        const record = (handler: unknown) => {
          records.set(prop, (records.get(prop) ?? 0) + 1);
          return { route: prop, handler };
        };
        return {
          handler: record,
          effect: record,
        };
      },
    },
  ) as BosBuilder;
}

describe("handler module structure", () => {
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
