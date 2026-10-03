import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneUnusedUiFiles } from "../../src/cli/prune";

describe("pruneUnusedUiFiles", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function scaffold(): string {
    const dir = mkdtempSync(join(tmpdir(), "bos-prune-"));
    tempDirs.push(dir);
    const src = join(dir, "ui", "src");
    const write = (relPath: string, content = "") => {
      const full = join(src, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    };

    write("entry.ts", `import "./styles.css";\nimport("./hydrate");\n`);
    write("styles.css", "");
    write("app.ts", `export { createApiClient } from "./lib/api";\n`);
    write(
      "routes/index.tsx",
      `import { UsedCard } from "@/components";\nimport { usedHelper } from "@/lib/used";\nexport const Route = UsedCard;\nexport const h = usedHelper;\n`,
    );
    write("lib/used.ts", "export const usedHelper = 1;\n");
    write("lib/unused.ts", "export const unusedHelper = 2;\n");
    write("lib/near-rpc-like.ts", "export const dead = 3;\n");
    write(
      "components/index.ts",
      [
        `export { Badge } from "./ui/badge";`,
        `export { UsedCard } from "./used-card";`,
        `export { DeadCard } from "./dead-card";`,
        "",
      ].join("\n"),
    );
    write("components/ui/badge.tsx", "export const Badge = () => null;\n");
    write(
      "components/used-card.tsx",
      `import { Badge } from "./ui/badge";\nexport const UsedCard = Badge;\n`,
    );
    write("components/dead-card.tsx", "export const DeadCard = () => null;\n");
    write("components/dead-card.test.tsx", "import { DeadCard } from './dead-card';\n");
    write("components/ui/unused-primitive.tsx", "export const UnusedPrimitive = () => null;\n");
    write("components/document-fallback.tsx", "export const DocumentFallback = () => null;\n");
    write("routeTree.gen.ts", "export const routeTree = {};\n");
    return dir;
  }

  it("prunes lib and component files unreferenced by routes or framework files", () => {
    const dir = scaffold();

    const result = pruneUnusedUiFiles(dir, { log: () => {} });

    expect(result.pruned.sort()).toEqual([
      "ui/src/components/dead-card.test.tsx",
      "ui/src/components/dead-card.tsx",
      "ui/src/components/ui/unused-primitive.tsx",
      "ui/src/lib/near-rpc-like.ts",
      "ui/src/lib/unused.ts",
    ]);
    expect(existsSync(join(dir, "ui/src/lib/used.ts"))).toBe(true);
    expect(existsSync(join(dir, "ui/src/components/used-card.tsx"))).toBe(true);
    expect(existsSync(join(dir, "ui/src/components/ui/badge.tsx"))).toBe(true);
  });

  it("rewrites the components barrel to drop pruned export statements", () => {
    const dir = scaffold();

    pruneUnusedUiFiles(dir, { log: () => {} });

    const barrel = readFileSync(join(dir, "ui/src/components/index.ts"), "utf-8");
    expect(barrel).toContain('from "./ui/badge"');
    expect(barrel).toContain('from "./used-card"');
    expect(barrel).not.toContain("DeadCard");
  });

  it("keeps framework-owned fallback components without importing routes", () => {
    const dir = scaffold();

    pruneUnusedUiFiles(dir, { log: () => {} });

    expect(existsSync(join(dir, "ui/src/components/document-fallback.tsx"))).toBe(true);
    expect(existsSync(join(dir, "ui/src/routeTree.gen.ts"))).toBe(true);
    expect(existsSync(join(dir, "ui/src/styles.css"))).toBe(true);
  });

  it("keeps the whole barrel alive on a namespace import", () => {
    const dir = scaffold();
    writeFileSync(
      join(dir, "ui/src/routes/index.tsx"),
      `import * as C from "@/components";\nexport const Route = C;\n`,
    );

    pruneUnusedUiFiles(dir, { log: () => {} });

    expect(existsSync(join(dir, "ui/src/components/dead-card.tsx"))).toBe(true);
    // not exported by the barrel, so saturation doesn't save it either
    expect(existsSync(join(dir, "ui/src/components/ui/unused-primitive.tsx"))).toBe(false);
    // lib files unused by the namespace importer are still pruned
    expect(existsSync(join(dir, "ui/src/lib/unused.ts"))).toBe(false);
  });

  it("keeps test files whose subject survives", () => {
    const dir = scaffold();
    writeFileSync(
      join(dir, "ui/src/components/used-card.test.tsx"),
      `import { UsedCard } from './used-card';\n`,
    );

    pruneUnusedUiFiles(dir, { log: () => {} });

    expect(existsSync(join(dir, "ui/src/components/used-card.test.tsx"))).toBe(true);
  });
});
