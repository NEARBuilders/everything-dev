import { describe, expect, it } from "vitest";
import { exitCodeFor } from "../../src/cli/exit-codes";

describe("exitCodeFor", () => {
  it("maps error-status results to 1", () => {
    expect(exitCodeFor({ status: "error", error: "boom" })).toBe(1);
  });

  it("maps success-shaped results to 0", () => {
    expect(exitCodeFor({ status: "success" })).toBe(0);
    expect(exitCodeFor({ status: "published" })).toBe(0);
    expect(exitCodeFor({ status: "updated" })).toBe(0);
    expect(exitCodeFor({ status: "listed", plugins: [] })).toBe(0);
  });

  it("prefers the explicit code when a result carries one", () => {
    expect(exitCodeFor({ code: 1 })).toBe(1);
    expect(exitCodeFor({ code: 0 })).toBe(0);
  });

  it("maps an error string result to 1", () => {
    expect(exitCodeFor({ error: "boom", status: undefined })).toBe(1);
  });

  it("maps absent results to 0", () => {
    expect(exitCodeFor(undefined)).toBe(0);
  });
});
