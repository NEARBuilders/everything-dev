import { describe, expect, it } from "vitest";
import {
  authoredSlotPaths,
  stampInheritedReleaseSlots,
} from "../../src/services/resolution/release-plane";

const record = (base: string, version = "1") => ({
  base,
  pin: {
    manifest: `https://cdn.test/${base}/mf-manifest.json`,
    integrity: `sha384-${base}-${version}`,
  },
});

const consumerShape = (merged: Record<string, unknown>) => merged;

describe("release-plane stamping", () => {
  const slots = {
    "app.auth": record("https://auth.test/slot"),
    "app.auth.ui": record("https://auth.test/ui"),
    "plugins.ai": record("https://ai.test/slot"),
    "plugins.newcomer": record("https://new.test/slot"),
  };

  const authored = {
    extends: "bos://parent/p.gw",
    app: {
      ui: { extends: "bos://elsewhere/ui" },
      auth: { variables: { ka: "kept" } },
    },
  };

  const merged = {
    extends: "bos://parent/p.gw",
    app: {
      host: { production: "https://live.test/host" },
      ui: {
        production: "https://elsewhere-live.test/ui",
        pin: { manifest: "old", integrity: "old" },
      },
      auth: {
        production: "https://live-parent.test/auth",
        ui: { production: "https://live-parent.test/auth-ui" },
        variables: { ka: "kept" },
      },
    },
    plugins: {
      ai: { name: "ai", production: "https://live-parent.test/ai" },
    },
  };

  it("consumer mode merges the release pins into every inherited entry", () => {
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedReleaseSlots({
      config,
      authoredConfig: structuredClone(authored),
      slots,
      mode: "consumer",
    });

    expect(outcome.stamped).toEqual(["app.auth", "app.auth.ui", "plugins.ai"]);
    expect(outcome.omitted).toEqual(["plugins.newcomer"]);
    const config1 = config as typeof merged;
    expect(config1.app.auth.production).toBe("https://auth.test/slot");
    expect(config1.app.auth.pin.integrity).toBe("sha384-https://auth.test/slot-1");
    expect(config1.app.auth.ui.production).toBe("https://auth.test/ui");
    expect(config1.app.auth.variables).toEqual({ ka: "kept" });
    expect(config1.plugins.ai.production).toBe("https://ai.test/slot");
    expect("newcomer" in config1.plugins).toBe(false);
  });

  it("keeps child-authored slots untouched (configuring is not authoring; authoring wins)", () => {
    const authoredConfig = {
      ...authored,
      app: {
        ...authored.app,
        auth: { production: "https://child.test/auth", extends: "bos://child/code" },
      },
    };
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedReleaseSlots({
      config,
      authoredConfig,
      slots,
      mode: "consumer",
    });
    expect(outcome.stamped).not.toContain("app.auth");
    const config1 = config as typeof merged;
    expect(config1.app.auth.production).toBe("https://live-parent.test/auth");
  });

  it("omits post-release provisioned slots instead of live-following them", () => {
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedReleaseSlots({
      config,
      authoredConfig: structuredClone(authored),
      slots,
      mode: "consumer",
    });
    expect(outcome.omitted).toEqual(["plugins.newcomer"]);
    const config1 = config as typeof merged;
    expect("newcomer" in config1.plugins).toBe(false);
  });

  it("payload mode stamps app.* only and creates entries outright (#679 semantics)", () => {
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedReleaseSlots({
      config,
      authoredConfig: structuredClone(authored),
      slots,
      mode: "payload",
    });
    expect(outcome.stamped).toEqual(["app.auth", "app.auth.ui"]);
    const config1 = config as typeof merged;
    expect(config1.app.auth.ui.production).toBe("https://auth.test/ui");
    expect("newcomer" in config1.plugins).toBe(false);
  });

  it("a manifest without slots stamps nothing — pre-slot releases degrade to live-follow", () => {
    const config = structuredClone(consumerShape(merged));
    const outcome = stampInheritedReleaseSlots({
      config,
      authoredConfig: structuredClone(authored),
      slots: undefined,
      mode: "consumer",
    });
    expect(outcome.stamped).toEqual([]);
    expect(outcome.omitted).toEqual([]);
    expect((config as typeof merged).app.auth.production).toBe("https://live-parent.test/auth");
  });

  it("authoredSlotPaths treats configuring entries as non-authored and bare plugin refs as full owners", () => {
    const paths = authoredSlotPaths({
      app: { auth: { variables: {} }, host: { production: "x" } },
      plugins: { votes: "bos://plats/votes" },
    });
    expect(paths.has("app.auth")).toBe(false);
    expect(paths.has("app.host")).toBe(true);
    expect(paths.has("plugins.votes")).toBe(true);
    expect(paths.has("plugins.votes.ui")).toBe(true);
  });
});
