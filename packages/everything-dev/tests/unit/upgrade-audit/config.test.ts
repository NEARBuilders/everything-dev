import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkConfig } from "../../../src/services/scaffold/upgrade-audit/checks/config";
import { blockerMessages, warnMessages } from "./test-helpers";

const nonconformant = join(
  import.meta.dirname,
  "../../../src/services/scaffold/upgrade-audit/fixtures/nonconformant",
);

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "v2-upgrade-config-"));
  await cp(nonconformant, projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("checkConfig", () => {
  it("passes the conformant fixture with no findings", async () => {
    const findings = await Effect.runPromise(
      checkConfig(
        join(
          import.meta.dirname,
          "../../../src/services/scaffold/upgrade-audit/fixtures/conformant",
        ),
      ),
    );
    expect(findings).toEqual([]);
  });

  it("blocks when extends is missing or not a bos:// ref", async () => {
    const configPath = join(projectDir, "bos.config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8")) as Record<string, unknown>;
    delete config.extends;
    await writeFile(configPath, JSON.stringify(config, null, 2));
    const findings = await Effect.runPromise(checkConfig(projectDir));
    expect(blockerMessages(findings).join("\n")).toMatch(/"extends" must be a bos:\/\/ ref/);
  });

  it("warns on keys not mappable to the v2 surface", async () => {
    const findings = await Effect.runPromise(checkConfig(projectDir));
    expect(warnMessages(findings).join("\n")).toMatch(/unknown top-level key "mysteryKey"/);
  });
});
