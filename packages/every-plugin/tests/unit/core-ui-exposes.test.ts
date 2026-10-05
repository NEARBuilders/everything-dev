import { describe, expect, it } from "vitest";
import {
  CORE_UI_NODE_ENTRY,
  CORE_UI_NODE_EXPOSES,
  CORE_UI_WEB_ENTRY,
  CORE_UI_WEB_EXPOSES,
} from "../../src/build/ui/factory";

describe("core ui build surface", () => {
  it("builds from the generated stubs and exposes only the surfaces with consumers", () => {
    expect(CORE_UI_WEB_ENTRY).toBe("./src/entry.gen.ts");
    expect(CORE_UI_WEB_EXPOSES).toEqual({
      "./Hydrate": "./src/hydrate.gen.tsx",
      "./components": "./src/components/index.ts",
    });
    expect(CORE_UI_NODE_ENTRY).toBe("./src/router.server.gen.tsx");
    expect(CORE_UI_NODE_EXPOSES).toEqual({
      "./Router": "./src/router.server.gen.tsx",
      "./compose": "./src/compose.gen.ts",
      "./routeConfig": "./src/routeConfig.gen.ts",
    });
  });
});
