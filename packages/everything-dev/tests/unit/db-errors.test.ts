import { describe, expect, it } from "vitest";
import { DatabaseError, unwrapDatabaseError } from "../../src/db/errors";

describe("unwrapDatabaseError (#798)", () => {
  it("never throws on a null-prototype cause", () => {
    const error = new DatabaseError({ stage: "driver", cause: Object.create(null) });
    expect(() => unwrapDatabaseError(error)).not.toThrow();
    expect(() => error.message).not.toThrow();
    expect(error.message).toContain("DatabaseError [stage=driver]");
  });

  it("renders a circular non-Error cause via the String fallback", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(unwrapDatabaseError(circular)).toBe("[object Object]");
  });

  it("keeps plain string causes readable", () => {
    expect(unwrapDatabaseError("connection refused")).toBe("connection refused");
  });

  it("joins an Error cause chain", () => {
    const outer = new Error("outer", { cause: new Error("inner") });
    expect(unwrapDatabaseError(outer)).toBe("outer: inner");
  });

  it("appends a non-Error tail of a cause chain instead of dropping it", () => {
    const outer = new Error("outer", { cause: Object.create(null) });
    expect(unwrapDatabaseError(outer)).toBe("outer: {}");
  });
});
