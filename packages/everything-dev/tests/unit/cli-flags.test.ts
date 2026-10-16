import { describe, expect, it } from "vitest";
import type { CommandDescriptor } from "../../src/cli/catalog";
import { commandCatalog, findCommandDescriptor } from "../../src/cli/catalog";
import { describeOf, flagHelpLines } from "../../src/cli/flags";
import { bosContract, cliCommandMeta, commandOptionSchemas } from "../../src/contract";
import { cliCommandMeta as facadeMeta } from "../../src/contract.meta";

function descriptorFor(key: keyof typeof bosContract): CommandDescriptor {
  return commandCatalog.find((d) => d.key === key) as CommandDescriptor;
}

describe("describeOf", () => {
  it("reads the description through optional/default wrappers", () => {
    const { z } = require("zod") as { z: typeof import("zod").z };
    const wrapped = z
      .enum(["history-reset", "recreate"])
      .default("history-reset")
      .describe("Repair mode: history-reset (default) or recreate (not yet supported)");
    expect(describeOf(wrapped)).toContain("history-reset");

    const optional = z.string().optional().describe("Parent to extend from");
    expect(describeOf(optional)).toContain("Parent to extend from");

    expect(describeOf(z.string())).toBeUndefined();
  });
});

describe("flagHelpLines", () => {
  it("derives every documented flag from the contract schema — the single flag source", () => {
    const descriptor = descriptorFor("dbRepair");
    const lines = flagHelpLines(descriptor);
    const text = lines.join("\n");

    expect(text).toContain("--plugin");
    expect(text).toContain("Plugin key: api, auth, or a plugin name");
    expect(text).toContain("--mode");
    expect(text).toContain("history-reset");
    expect(text).toContain("--yes");
    expect(text).toContain("Skip confirmation prompt");
  });

  it("includes init's extends and overrides flags", () => {
    const text = flagHelpLines(descriptorFor("init")).join("\n");
    expect(text).toContain("--extends");
    expect(text).toContain("Parent to extend from");
    expect(text).toContain("--overrides");
    expect(text).toContain("ui,api,host,plugins");
  });

  it("marks booleans and defaults", () => {
    const lines = flagHelpLines(descriptorFor("dbRepair"));
    const yesLine = lines.find((l) => l.trim().startsWith("--yes"));
    expect(yesLine).toContain("(boolean)");

    const modeLine = lines.find((l) => l.trim().startsWith("--mode"));
    expect(modeLine).toContain("default: history-reset");
  });

  it("covers every command with an option schema", () => {
    for (const [key] of Object.entries(commandOptionSchemas)) {
      const descriptor = descriptorFor(key as keyof typeof bosContract);
      expect(flagHelpLines(descriptor).length).toBeGreaterThan(0);
    }
  });
});

describe("command meta lives in the contract", () => {
  it("the contract.meta facade re-exports the same source", () => {
    expect(facadeMeta).toBe(cliCommandMeta);
  });

  it("every contract command has a summary", () => {
    for (const key of Object.keys(bosContract)) {
      const meta = cliCommandMeta[key as keyof typeof cliCommandMeta];
      if (meta?.summary) continue;
      // commands without explicit meta get a split-camelCase fallback — the
      // catalog covers them; here just require the big ones are explicit
      if (["dev", "start", "build", "deploy", "init", "sync", "import", "upgrade"].includes(key)) {
        expect(meta?.summary, key).toBeTruthy();
      }
    }
  });

  it("findCommandDescriptor resolves multi-word paths", () => {
    expect(findCommandDescriptor(["plugin", "add"]).descriptor.key).toBe("pluginAdd");
    expect(findCommandDescriptor(["registry", "use"]).descriptor.key).toBe("registryUse");
  });
});
