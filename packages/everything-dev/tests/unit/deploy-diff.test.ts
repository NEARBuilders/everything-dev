import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  diffWorkspaceFiles,
  localObjectIntegrity,
  localSriMap,
  mergedFileIntegrity,
  pinsFromDeployState,
  pinsFromPublishedConfig,
  readDeployState,
  upsertDeployStatePins,
  workspaceKeyOfBase,
} from "../../src/deploy-diff";
import type { BosConfigInput } from "../../src/types";

const bytes = (content: string) => new TextEncoder().encode(content);
const file = (path: string, content: string) => ({ path, bytes: bytes(content) });
const sriOf = (content: string) =>
  `sha384-${createHash("sha384").update(bytes(content)).digest("base64")}`;

describe("localObjectIntegrity / localSriMap", () => {
  it("computes the sha384 SRI the storage route would compute", () => {
    const content = "console.log('hi');";
    expect(localObjectIntegrity(bytes(content))).toBe(sriOf(content));
  });

  it("keys the map by object path", () => {
    const map = localSriMap([file("a.js", "aaa"), file("b.js", "bbb")]);
    expect(map).toEqual({ "a.js": sriOf("aaa"), "b.js": sriOf("bbb") });
  });
});

describe("diffWorkspaceFiles", () => {
  const files = [file("unchanged.js", "same"), file("changed.js", "v2"), file("new.js", "fresh")];
  const localSri = localSriMap(files);
  const prevFiles = {
    "unchanged.js": sriOf("same"),
    "changed.js": sriOf("v1"),
    "gone.js": sriOf("dropped"),
  };

  it("uploads new and changed files, skips byte-identical ones", () => {
    const diff = diffWorkspaceFiles(files, localSri, prevFiles);
    expect(diff.upload.map((f) => f.path)).toEqual(["changed.js", "new.js"]);
    expect(diff.skipped).toBe(1);
  });

  it("uploads everything when the previous map has no entry for a path", () => {
    const diff = diffWorkspaceFiles(files, localSri, {});
    expect(diff.skipped).toBe(0);
    expect(diff.upload).toHaveLength(3);
  });

  it("treats a prev SRI of a different hash length as a change, not a skip", () => {
    const diff = diffWorkspaceFiles([file("a.js", "same")], localSriMap([file("a.js", "same")]), {
      "a.js": "sha384-not-the-real-sri",
    });
    expect(diff.skipped).toBe(0);
  });
});

describe("mergedFileIntegrity", () => {
  it("uploaded files take the server SRI, skipped files carry the previous one, dropped files vanish", () => {
    const files = [file("uploaded.js", "new"), file("skipped.js", "same")];
    const merged = mergedFileIntegrity(
      files,
      { "uploaded.js": sriOf("new") },
      { "skipped.js": sriOf("same"), "dropped.js": sriOf("gone") },
    );
    expect(merged).toEqual({
      "uploaded.js": sriOf("new"),
      "skipped.js": sriOf("same"),
    });
  });

  it("never invents an SRI for a file that was neither uploaded nor previously mapped", () => {
    const merged = mergedFileIntegrity([file("a.js", "x")], {}, undefined);
    expect(merged).toEqual({});
  });
});

describe("workspaceKeyOfBase", () => {
  it("extracts the workspace key from a bundle base URL", () => {
    expect(workspaceKeyOfBase("https://cdn.test/bundles/a.near/g.test/auth-ui/")).toBe("auth-ui");
    expect(workspaceKeyOfBase("https://cdn.test/bundles/a.near/g.test/ui")).toBe("ui");
  });

  it("returns null for non-bundle bases", () => {
    expect(workspaceKeyOfBase("https://cdn.test/ui/")).toBeNull();
  });
});

describe("deploy-state pointer", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "bos-deploy-diff-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("upserts and reads back pins per account/gateway", () => {
    upsertDeployStatePins(configDir, "a.near", "g.test", {
      ui: { manifest: "versions/aaaaaaaaaaaaaaaa.json", integrity: "sha384-aaa" },
    });
    upsertDeployStatePins(configDir, "a.near", "g.test", {
      ui: { manifest: "versions/bbbbbbbbbbbbbbbb.json", integrity: "sha384-bbb" },
      api: { manifest: "versions/cccccccccccccccc.json", integrity: "sha384-ccc" },
    });

    const pins = pinsFromDeployState(configDir, "a.near", "g.test");
    expect(pins.ui).toEqual({
      manifest: "versions/bbbbbbbbbbbbbbbb.json",
      integrity: "sha384-bbb",
    });
    expect(pins.api).toEqual({
      manifest: "versions/cccccccccccccccc.json",
      integrity: "sha384-ccc",
    });
    // other namespaces stay empty
    expect(pinsFromDeployState(configDir, "other.near", "g.test")).toEqual({});
  });

  it("degrades to empty state on a corrupt or old pointer file", () => {
    mkdirSync(join(configDir, ".bos"), { recursive: true });
    writeFileSync(join(configDir, ".bos", "deploy-state.json"), "not json{");
    expect(readDeployState(configDir)).toEqual({ version: 1, apps: {} });
    expect(pinsFromDeployState(configDir, "a.near", "g.test")).toEqual({});
  });
});

describe("pinsFromPublishedConfig", () => {
  const account = "a.near";
  const gateway = "g.test";
  const pin = { manifest: "versions/aaaaaaaaaaaaaaaa.json", integrity: "sha384-aaa" };
  const config = {
    app: {
      ui: {
        production: `https://cdn.test/bundles/${account}/${gateway}/ui/`,
        pin,
      },
    },
    plugins: {
      auth: {
        production: `https://cdn.test/bundles/${account}/${gateway}/auth/`,
        pin,
        ui: {
          production: `https://cdn.test/bundles/${account}/${gateway}/auth-ui/`,
          pin,
        },
      },
      remote: {
        // a pinned slot under a different namespace must be ignored
        production: "https://cdn.test/bundles/other.near/other.test/remote/",
        pin,
      },
    },
  } as unknown as BosConfigInput;

  it("maps bundle bases back to workspace keys, filtered to the namespace", () => {
    const pins = pinsFromPublishedConfig(config, account, gateway);
    expect(Object.keys(pins).sort()).toEqual(["auth", "auth-ui", "ui"]);
    expect(pins.ui).toEqual(pin);
  });

  it("ignores slots whose production base is not a bundle base", () => {
    const pins = pinsFromPublishedConfig(
      {
        app: { ui: { production: "https://cdn.test/ui/", pin } },
      } as unknown as BosConfigInput,
      account,
      gateway,
    );
    expect(pins).toEqual({});
  });
});
