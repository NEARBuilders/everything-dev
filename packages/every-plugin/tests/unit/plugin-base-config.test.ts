import { describe, expect, it } from "vitest";
import { createPluginBaseConfig } from "../../src/build/rspack/compose";

class StubPlugin {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

const pluginNames = (config: { plugins: unknown[] }) =>
  config.plugins.map((plugin) => (plugin as { name?: string }).name);

describe("createPluginBaseConfig", () => {
  it("composes the defaults when no options are passed", () => {
    const config = createPluginBaseConfig();
    const names = pluginNames(config);
    expect(names).toContain("EveryPluginComposedBuild");
  });

  it("appends extraPlugins after the composed defaults, order preserved", () => {
    const first = new StubPlugin("first-extra");
    const second = new StubPlugin("second-extra");
    const config = createPluginBaseConfig({ extraPlugins: [first, second] });

    const names = pluginNames(config);
    expect(names.indexOf("EveryPluginComposedBuild")).toBeLessThan(names.indexOf("first-extra"));
    expect(names).toEqual(
      expect.arrayContaining(["EveryPluginComposedBuild", "first-extra", "second-extra"]),
    );
    expect(names.indexOf("first-extra")).toBeLessThan(names.indexOf("second-extra"));
    expect(config.plugins.at(-1)).toBe(second);
    expect(config.plugins.at(-2)).toBe(first);
  });

  it("keeps the composed plugin set identical when no extras are declared", () => {
    const bare = createPluginBaseConfig();
    const withOtherOptions = createPluginBaseConfig({ externals: ["pg"] });
    expect(pluginNames(withOtherOptions)).toEqual(pluginNames(bare));
    expect(withOtherOptions.externals).toEqual(["pg"]);
  });
});
