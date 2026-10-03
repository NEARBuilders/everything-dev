import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = `
const { suppressPgQueryQueueDeprecation } = require("./src/db/index.ts");
suppressPgQueryQueueDeprecation();
const util = require("node:util");
const pgQuery = util.deprecate(
  () => {},
  "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0.",
);
pgQuery();
process.emitWarning("some other warning", "CustomWarning");
console.log("MARKER_DONE");
`;

describe.each([
  ["bun", ["bun", "-e", script]],
  ["node via tsx", ["bunx", "tsx", "-e", script]],
])("suppressPgQueryQueueDeprecation under %s", (_label, command) => {
  it("silences the pg query-queue deprecation but re-prints other warnings", () => {
    const cwd = new URL("../../", import.meta.url).pathname;
    const result = spawnSync(command[0], command.slice(1), {
      cwd,
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output).toContain("MARKER_DONE");
    expect(output).not.toContain("client.query() when the client is already executing");
    expect(output).toContain("some other warning");
  });
});
