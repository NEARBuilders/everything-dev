import { describe, expect, it } from "vitest";
import { setSnapshotWatchIntervalForBoot } from "../../src/services/start/boot";
import type { StartConfigSource } from "../../src/services/start/source";

const REGISTRY_SOURCE: StartConfigSource = { registry: { account: "a.near", domain: "a.dev" } };
const CONFIG_PATH_SOURCE: StartConfigSource = { configPath: "/app/bos.config.json" };

function intervalAfter(
  source: StartConfigSource,
  env: "production" | "staging",
  preset?: string,
): string | undefined {
  const store: Record<string, string> = preset ? { BOS_SNAPSHOT_WATCH_INTERVAL_MS: preset } : {};
  setSnapshotWatchIntervalForBoot(source, env, store);
  return store.BOS_SNAPSHOT_WATCH_INTERVAL_MS;
}

describe("setSnapshotWatchIntervalForBoot", () => {
  it("disables the watch for a config-path production boot (the boot config is the truth)", () => {
    expect(intervalAfter(CONFIG_PATH_SOURCE, "production")).toBe("0");
  });

  it("keeps the watch for identity-driven production boots (adopting publishes is the feature)", () => {
    expect(intervalAfter(REGISTRY_SOURCE, "production")).toBeUndefined();
  });

  it("keeps the watch in staging and for bare local starts", () => {
    expect(intervalAfter(CONFIG_PATH_SOURCE, "staging")).toBeUndefined();
    expect(intervalAfter({}, "production")).toBeUndefined();
  });

  it("never overrides an operator-set interval", () => {
    expect(intervalAfter(CONFIG_PATH_SOURCE, "production", "30000")).toBe("30000");
  });
});
