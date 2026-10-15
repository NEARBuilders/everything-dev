import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeWorkspacePath, parseFromSpec } from "../../src/cli/import";

describe("bos import — parseFromSpec", () => {
  it("parses owner/repo shorthand into a github URL", () => {
    expect(parseFromSpec("NEARBuilders/everything-dev")).toEqual({
      kind: "github",
      repo: "https://github.com/NEARBuilders/everything-dev",
    });
  });

  it("parses owner/repo@ref", () => {
    expect(parseFromSpec("NEARBuilders/everything-dev@v1.2.3")).toEqual({
      kind: "github",
      repo: "https://github.com/NEARBuilders/everything-dev",
      ref: "v1.2.3",
    });
  });

  it("splits on the first @ so changesets tags keep their own @", () => {
    expect(parseFromSpec("NEARBuilders/everything-dev@everything-dev@2.0.0-rc.8")).toEqual({
      kind: "github",
      repo: "https://github.com/NEARBuilders/everything-dev",
      ref: "everything-dev@2.0.0-rc.8",
    });
  });

  it("parses a full GitHub URL", () => {
    expect(parseFromSpec("https://github.com/NEARBuilders/everything-dev")).toEqual({
      kind: "github",
      repo: "https://github.com/NEARBuilders/everything-dev",
    });
  });

  it("parses a GitHub URL with a ref", () => {
    expect(parseFromSpec("https://github.com/NEARBuilders/everything-dev@develop")).toEqual({
      kind: "github",
      repo: "https://github.com/NEARBuilders/everything-dev",
      ref: "develop",
    });
  });

  it("accepts an existing local directory", () => {
    const dir = join(import.meta.dirname, "..");
    expect(parseFromSpec(dir)).toEqual({ kind: "local", dir });
  });

  it("rejects an absolute path that does not exist", () => {
    expect(() => parseFromSpec("/nonexistent/upstream-source-xyz")).toThrow(
      "Local directory not found",
    );
  });

  it("requires a source", () => {
    expect(() => parseFromSpec("   ")).toThrow("--from is required");
  });

  it("rejects an unparseable source", () => {
    expect(() => parseFromSpec("not a source")).toThrow("Cannot parse --from source");
  });
});

describe("bos import — normalizeWorkspacePath", () => {
  it("normalizes ./ prefix and trailing slashes", () => {
    expect(normalizeWorkspacePath("./plugins/auth/")).toBe("plugins/auth");
  });

  it("rejects absolute paths", () => {
    expect(() => normalizeWorkspacePath("/abs/workspace")).toThrow("repo-relative");
  });

  it("rejects traversal segments", () => {
    expect(() => normalizeWorkspacePath("../up")).toThrow("Invalid workspace path");
    expect(() => normalizeWorkspacePath("a/../b")).toThrow("Invalid workspace path");
  });

  it("rejects empty and dot paths", () => {
    expect(() => normalizeWorkspacePath(".")).toThrow("Invalid workspace path");
    expect(() => normalizeWorkspacePath("")).toThrow("Invalid workspace path");
  });
});
