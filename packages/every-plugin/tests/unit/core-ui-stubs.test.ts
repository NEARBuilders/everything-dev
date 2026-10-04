import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_UI_STUBS, emitCoreUiStubs } from "../../src/build/ui/stubs";

const root = join(tmpdir(), "every-plugin-core-ui-stubs");

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("core ui generated stubs", () => {
  it("declares exactly the bootstrap stub set", () => {
    expect(Object.keys(CORE_UI_STUBS).sort()).toEqual([
      "src/compose.gen.ts",
      "src/entry.gen.ts",
      "src/globals.gen.ts",
      "src/hydrate.gen.tsx",
      "src/router.server.gen.tsx",
    ]);
  });

  it("emits the stubs into the ui root and reports what changed", () => {
    fs.mkdirSync(join(root, "src"), { recursive: true });
    const written = emitCoreUiStubs(root);
    expect(written.sort()).toEqual([...Object.keys(CORE_UI_STUBS)].sort());
    for (const [rel, content] of Object.entries(CORE_UI_STUBS)) {
      expect(fs.readFileSync(join(root, rel), "utf-8")).toBe(content);
    }
  });

  it("is idempotent — unchanged stubs are not rewritten", () => {
    fs.mkdirSync(join(root, "src"), { recursive: true });
    emitCoreUiStubs(root);
    expect(emitCoreUiStubs(root)).toEqual([]);
  });

  it("wires the generated bootstrap to the authored router and gen artifacts", () => {
    const hydrate = CORE_UI_STUBS["src/hydrate.gen.tsx"]!;
    expect(hydrate).toContain('import { createRouter } from "./router"');
    expect(hydrate).toContain('import("./routeConfig.gen")');
    expect(hydrate).toContain('import("./manifest.gen.json")');
    expect(hydrate).toContain("coreHydrate(");
    expect(CORE_UI_STUBS["src/entry.gen.ts"]).toContain('import("./hydrate.gen")');
    expect(CORE_UI_STUBS["src/router.server.gen.tsx"]).toContain("createServerRouterModule");
    expect(CORE_UI_STUBS["src/compose.gen.ts"]).toContain('from "everything-dev/ui/manifest"');
    expect(CORE_UI_STUBS["src/globals.gen.ts"]).toContain("@rsbuild/core/types");
    for (const content of Object.values(CORE_UI_STUBS)) {
      expect(content.split("\n")[0]).toMatch(/GENERATED/);
    }
  });
});
