import { describe, expect, it } from "vitest";
import {
  classifyPublishedDiff,
  isHotRemote,
  isUiOnlyDiff,
  type PublishedDiff,
} from "../../src/services/deploy/changed-slots";

const uiPin = {
  production: "https://cdn.test/bundles/a.test/gw.test/ui/",
  digest: { manifest: "versions/aaaaaaaaaaaaaaaa.json", integrity: "sha384-ui" },
};
const uiPinNext = {
  production: uiPin.production,
  digest: { manifest: "versions/bbbbbbbbbbbbbbbb.json", integrity: "sha384-ui2" },
};
const apiPin = {
  production: "https://cdn.test/bundles/a.test/gw.test/api/",
  digest: { manifest: "versions/cccccccccccccccc.json", integrity: "sha384-api" },
};

const config = (overrides?: Record<string, unknown>) => ({
  account: "a.test",
  domain: "gw.test",
  app: {
    ui: uiPin,
    api: apiPin,
    ...(overrides?.app as Record<string, unknown> | undefined),
  },
  ...(overrides?.title ? { title: overrides.title } : {}),
});

describe("isHotRemote", () => {
  it("adopts the ui slot and plugin ui overrides; everything else is boot-frozen", () => {
    expect(isHotRemote("app.ui")).toBe(true);
    expect(isHotRemote("plugins.votes.ui")).toBe(true);
    expect(isHotRemote("app.api")).toBe(false);
    expect(isHotRemote("app.auth")).toBe(false);
    expect(isHotRemote("app.host")).toBe(false);
    expect(isHotRemote("plugins.votes")).toBe(false);
    expect(isHotRemote("app")).toBe(false);
  });
});

describe("classifyPublishedDiff", () => {
  it("reports the moved remote keys", () => {
    const diff = classifyPublishedDiff(config(), config({ app: { ui: uiPinNext } }));
    expect(diff.changedRemotes).toEqual(["app.ui"]);
    expect(diff.configChanged).toBe(false);
  });

  it("treats a first publish (no previous config) as everything changed and cold", () => {
    const diff = classifyPublishedDiff(null, config());
    expect(diff.configChanged).toBe(true);
    expect(isUiOnlyDiff(diff)).toBe(false);
  });

  it("digest-only changes do not count as config changes", () => {
    const diff = classifyPublishedDiff(config(), config({ app: { ui: uiPinNext } }));
    expect(diff.configChanged).toBe(false);
  });

  it("a non-remote config change (title) is cold even when the moved remote is hot", () => {
    const diff = classifyPublishedDiff(config(), {
      ...config({ app: { ui: uiPinNext } }),
      title: "renamed",
    });
    expect(diff.configChanged).toBe(true);
    expect(isUiOnlyDiff(diff)).toBe(false);
  });

  it("remotes added or removed count as changed", () => {
    const withoutApi = config();
    delete (withoutApi.app as Record<string, unknown>).api;
    const diff = classifyPublishedDiff(config(), withoutApi);
    expect(diff.changedRemotes).toEqual(["app.api"]);
    expect(isUiOnlyDiff(diff)).toBe(false);
  });

  it("an identical config changes nothing", () => {
    const diff = classifyPublishedDiff(config(), config());
    expect(diff).toEqual<PublishedDiff>({ changedRemotes: [], configChanged: false });
    expect(isUiOnlyDiff(diff)).toBe(false);
  });
});

describe("isUiOnlyDiff", () => {
  it("is true only when every changed remote is hot and the body is untouched", () => {
    expect(isUiOnlyDiff({ changedRemotes: ["app.ui"], configChanged: false })).toBe(true);
    expect(
      isUiOnlyDiff({ changedRemotes: ["app.ui", "plugins.votes.ui"], configChanged: false }),
    ).toBe(true);
    expect(isUiOnlyDiff({ changedRemotes: ["app.ui", "app.api"], configChanged: false })).toBe(
      false,
    );
    expect(isUiOnlyDiff({ changedRemotes: [], configChanged: false })).toBe(false);
    expect(isUiOnlyDiff({ changedRemotes: ["app.ui"], configChanged: true })).toBe(false);
  });
});
