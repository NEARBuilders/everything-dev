import { createPluginRuntime } from "every-plugin/runtime";
import { describe, expect, it } from "vitest";
import { TEST_PLUGIN_MANIFEST_URL } from "../setup/global-setup";

/**
 * A container's runtime code resolves its own chunks through the node
 * runtime's entry-URL fallback, keyed by the container's SELF name
 * (mf-manifest.json metaData.name). When the host registers the remote under
 * a different key, the fallback used to miss and the node runtime handed back
 * an empty chunk as if it had loaded — the exposed module then required ids
 * nothing had registered ("__webpack_modules__[r] is not a function").
 * Registering and loading under the container's self name keeps the lookup a
 * hit, so loading must succeed even under a host-side alias key.
 */
describe("remote self-name resolution", () => {
  it("loads a plugin whose container name differs from the host's registry key", async () => {
    const pluginRuntime = createPluginRuntime({
      registry: {
        "aliased-plugin": {
          remote: TEST_PLUGIN_MANIFEST_URL,
          description: "registered under a key the container does not know about itself",
        },
      },
    });

    const loaded = await pluginRuntime.loadPlugin("aliased-plugin");
    expect(loaded).toBeDefined();
    expect(loaded.ctor).toBeDefined();

    const instance = await pluginRuntime.instantiatePlugin("aliased-plugin", loaded);
    expect(instance.plugin.id).toBe("aliased-plugin");
  });
});
