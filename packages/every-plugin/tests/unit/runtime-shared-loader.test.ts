import { describe, expect, it } from "vitest";
import { loadEveryPluginSharedModule } from "../../src/runtime/services/module-federation.service";

describe("runtime framework share", () => {
  it("loads the source graph with the plugin factory attached", async () => {
    const framework = await loadEveryPluginSharedModule();

    expect(framework.createPlugin).toBeTypeOf("function");
    expect(framework.createPlugin.withPlugins).toBeTypeOf("function");
    expect(framework.createPluginRuntime).toBeTypeOf("function");
  });
});
