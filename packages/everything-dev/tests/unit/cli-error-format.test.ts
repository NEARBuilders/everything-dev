import { describe, expect, it } from "vitest";
import { describeMigrationFailure } from "../../src/cli/upgrade";
import { formatUnknownError } from "../../src/utils/errors";

describe("formatUnknownError (#522)", () => {
  it("renders structured rejections instead of [object Object]", () => {
    expect(formatUnknownError({ message: "GitHub tarball download failed" })).toBe(
      "GitHub tarball download failed",
    );
    expect(formatUnknownError({ message: "boom", stack: "at x" })).toBe("boom");
    expect(formatUnknownError({ error: "not found" })).toBe("not found");
    expect(formatUnknownError({ code: 404, ref: "v2.0.0-rc.15" })).toBe(
      JSON.stringify({ code: 404, ref: "v2.0.0-rc.15" }, null, 2),
    );
  });

  it("passes through strings, renders Errors with their cause, and defaults unknowns", () => {
    expect(formatUnknownError("plain message")).toBe("plain message");
    const caused = new Error("outer", { cause: new Error("inner") });
    expect(formatUnknownError(caused)).toBe("outer (cause: inner)");
    expect(formatUnknownError(null)).toBe("Unknown error");
    expect(formatUnknownError(undefined)).toBe("Unknown error");
    expect(formatUnknownError("")).toBe("Unknown error");
  });

  it("never throws on non-serializable values", () => {
    const circular: Record<string, unknown> = { message: "" };
    circular.self = circular;
    expect(typeof formatUnknownError(circular)).toBe("string");
  });
});

describe("describeMigrationFailure (#522)", () => {
  it("prefers the failed child's parsed error field over raw streams", () => {
    const stdout = JSON.stringify({ status: "error", error: "GitHub tarball download failed" });
    expect(describeMigrationFailure(stdout, "noise on stderr")).toBe(
      "GitHub tarball download failed",
    );
  });

  it("stringifies a structured child error object", () => {
    const stdout = JSON.stringify({
      status: "error",
      error: { message: "EISDIR: illegal operation on a directory" },
    });
    expect(describeMigrationFailure(stdout, undefined)).toBe(
      "EISDIR: illegal operation on a directory",
    );
  });

  it("falls back to stderr, then stdout, then unknown", () => {
    expect(describeMigrationFailure("not json", "[CLI] real failure")).toBe("[CLI] real failure");
    expect(describeMigrationFailure("plain stdout dump", "")).toBe("plain stdout dump");
    expect(describeMigrationFailure(undefined, undefined)).toBe("Unknown error");
  });

  it("ignores a successful JSON result and uses the raw streams", () => {
    const stdout = JSON.stringify({ status: "dry-run", packages: [] });
    expect(describeMigrationFailure(stdout, "stderr detail")).toBe("stderr detail");
  });
});
