import { describe, expect, it } from "vitest";
import { ArtifactGenError } from "../../src/code-artifacts";
import { describeError } from "../../src/utils/error";

describe("describeError", () => {
  it("surfaces a tagged error's phase and cause instead of 'Unknown error'", () => {
    const error = new ArtifactGenError({
      phase: "generate ui manifest (ui)",
      cause: new Error(
        'manifest generation failed for ui:\n  route "prototype/retro-frames" must live under a mount',
      ),
    });
    const message = describeError(error);
    expect(message).toContain("generate ui manifest (ui)");
    expect(message).toContain('route "prototype/retro-frames" must live under a mount');
  });

  it("keeps plain Error messages as-is", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("does not repeat a cause already contained in the message", () => {
    const inner = new Error("disk full");
    expect(describeError(new Error("write failed: disk full", { cause: inner }))).toBe(
      "write failed: disk full",
    );
  });

  it("walks plain-object failures and strings", () => {
    expect(describeError({ _tag: "NotFound" })).toBe("NotFound");
    expect(describeError("nope")).toBe("nope");
  });

  it("falls back to 'Unknown error' only when nothing is describable", () => {
    expect(describeError(undefined)).toBe("Unknown error");
    expect(describeError({})).toBe("Unknown error");
  });

  it("survives self-referencing causes", () => {
    const a: { message: string; cause?: unknown } = { message: "" };
    const b = { message: "", cause: a };
    a.cause = b;
    expect(describeError(a)).toBe("Unknown error");
  });
});
