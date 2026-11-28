import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pruneUnusedUiFiles } from "../../src/cli/prune";

/**
 * The barrel's wanted names must accumulate across every importer. Routes are
 * scanned in directory order; the pruner used to apply only the first
 * importer's names, so later routes lost barrel exports (Badge et al.) and the
 * scaffolded advanced tree failed its own typecheck (born-healthy matrix,
 * plan 067).
 */
describe("pruneUnusedUiFiles — barrel wanted-names union", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  it("keeps every barrel export some reachable route imported, whatever the scan order", () => {
    const dir = mkdtempSync(join(tmpdir(), "prune-union-"));
    dirs.push(dir);
    const src = join(dir, "ui", "src");
    const write = (relative: string, content: string) => {
      const path = join(src, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    };

    write("app.tsx", 'import { createFileRoute } from "@tanstack/react-router";');
    // Directory order puts _aaa before _zzz: the first barrel importer's
    // names must not bound what the later route keeps.
    write("routes/_aaa.tsx", 'import { Button } from "@/components";\nexport const x = Button;');
    write("routes/_zzz.tsx", 'import { Badge } from "@/components";\nexport const x = Badge;');
    write(
      "components/index.ts",
      'export { Button } from "./ui/button";\nexport { Badge } from "./ui/badge";\nexport { Card } from "./ui/card";\n',
    );
    write("components/ui/button.tsx", "export const Button = () => null;");
    write("components/ui/badge.tsx", "export const Badge = () => null;");
    write("components/ui/card.tsx", "export const Card = () => null;");

    pruneUnusedUiFiles(dir);

    expect(existsSync(join(src, "components/ui/button.tsx"))).toBe(true);
    expect(existsSync(join(src, "components/ui/badge.tsx"))).toBe(true);
    // Never imported by any route — pruned.
    expect(existsSync(join(src, "components/ui/card.tsx"))).toBe(false);
    const barrel = readFileSync(join(src, "components", "index.ts"), "utf-8");
    expect(barrel).toContain("./ui/button");
    expect(barrel).toContain("./ui/badge");
    expect(barrel).not.toContain("./ui/card");
  });
});
