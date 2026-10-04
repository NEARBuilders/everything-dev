import { describe, expect, it } from "vitest";
import { CORE_UI_NODE_EXPOSES, CORE_UI_WEB_EXPOSES } from "../../src/build/ui/factory";

describe("core ui exposes", () => {
  it("exposes only the surfaces with consumers", () => {
    expect(Object.keys(CORE_UI_WEB_EXPOSES).sort()).toEqual(["./Hydrate", "./components"]);
    expect(Object.keys(CORE_UI_NODE_EXPOSES).sort()).toEqual([
      "./Router",
      "./compose",
      "./routeConfig",
    ]);
  });
});
