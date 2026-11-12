import { Cause } from "effect";
import { describe, expect, it } from "vitest";
import { PluginBootstrapError, pluginFailureCause } from "../../src/services/plugins";

const entry = { key: "votes", config: { url: "http://cdn.example.com/votes" } };

describe("pluginFailureCause", () => {
  it("passes a typed PluginBootstrapError through unchanged", () => {
    const typed = new PluginBootstrapError({
      pluginKey: "votes",
      pluginUrl: entry.config.url,
      stage: "db-migration",
      dbSecret: "VOTES_DATABASE_URL",
      dbUrlMasked: "postgres://…",
      execution: "local-host-process",
      cause: new Error("migration boom"),
    });

    expect(pluginFailureCause(entry, Cause.fail(typed))).toBe(typed);
  });

  it("synthesizes a stage-init error naming the plugin when a defect escapes", () => {
    const defect = new TypeError("undefined is not a function");

    const err = pluginFailureCause(entry, Cause.die(defect));

    expect(err._tag).toBe("PluginBootstrapError");
    expect(err.pluginKey).toBe("votes");
    expect(err.pluginUrl).toBe(entry.config.url);
    expect(err.stage).toBe("init");
    expect(err.cause).toBe(defect);
  });

  it("synthesizes the same way for foreign typed failures", () => {
    const foreign = new Error("config fell over");

    const err = pluginFailureCause(entry, Cause.fail(foreign));

    expect(err.pluginKey).toBe("votes");
    expect(err.stage).toBe("init");
    expect(err.cause).toBe(foreign);
  });
});
