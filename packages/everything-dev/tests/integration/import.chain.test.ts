import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { importWorkspace } from "../../src/cli/import";
import { resetConfigPathCache } from "../../src/config";
import type { ImportOptions } from "../../src/contract";

const WS = "plugins/auth";
const _SCRATCH = join(import.meta.dirname, "..", "fixtures", "bos-import-chain-int-scratch");

describe("bos import — chain-resolved source (from omitted)", () => {
  let childDir: string;
  let localChildDir: string;

  beforeAll(() => {
    childDir = join(
      import.meta.dirname,
      "..",
      "fixtures",
      "bos-import-chain-int-scratch",
      "int-child",
    );
    mkdirSync(childDir, { recursive: true });
    writeFileSync(
      join(childDir, "bos.app.ts"),
      `import { App } from "everything-dev/descriptor";

export default App({
  name: "child.test",
  account: "child.near",
});
`,
    );
    localChildDir = join(
      import.meta.dirname,
      "..",
      "fixtures",
      "bos-import-chain-int-scratch",
      "int-child-local",
    );
    mkdirSync(localChildDir, { recursive: true });
    writeFileSync(
      join(localChildDir, "bos.app.ts"),
      `import { App, Plugin } from "everything-dev/descriptor";

export default App({
  name: "child.test",
  account: "child.near",
  auth: Plugin("auth").path(${JSON.stringify(WS)}),
});
`,
    );
  });

  afterEach(() => {
    resetConfigPathCache();
  });

  afterAll(() => {
    rmSync(join(import.meta.dirname, "..", "fixtures", "bos-import-chain-int-scratch"), {
      recursive: true,
      force: true,
    });
  });

  const options = (overrides: Partial<ImportOptions> = {}): ImportOptions => ({
    workspace: WS,
    from: undefined,
    yes: false,
    dryRun: false,
    noInstall: true,
    json: false,
    ...overrides,
  });

  it("errors when the child itself declares the workspace locally", async () => {
    const result = await importWorkspace(localChildDir, options());
    expect(result.status).toBe("error");
    expect(result.error).toContain("is declared locally in your authored config");
  });

  it("errors when nothing in the chain declares the workspace", async () => {
    const result = await importWorkspace(childDir, options());
    expect(result.status).toBe("error");
    expect(result.error).toContain(`No runtime in the extends chain declares workspace "${WS}"`);
    expect(result.error).toContain("Pass the upstream explicitly with --from");
  });

  it("rejects a targeted bos:// source", async () => {
    const result = await importWorkspace(
      childDir,
      options({ from: "bos://base.near/base#plugins.auth" }),
    );
    expect(result.status).toBe("error");
    expect(result.error).toContain("Targeted extends refs are not supported");
  });

  it("rejects a bos:// source with path segments", async () => {
    const result = await importWorkspace(childDir, options({ from: "bos://base.near/base/extra" }));
    expect(result.status).toBe("error");
    expect(result.error).toContain("expected bos://<account>/<gateway>");
  });
});
