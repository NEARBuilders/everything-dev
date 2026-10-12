import { describe, expect, it } from "vitest";
import { isSuppressedWarning } from "../../src/utils/warning-filter";

const experimentalWarning = (message: string) =>
  Object.assign(new Error(message), { name: "ExperimentalWarning" });

describe("isSuppressedWarning", () => {
  it("matches the vm main-context default loader warning", () => {
    const warning = experimentalWarning(
      "vm.USE_MAIN_CONTEXT_DEFAULT_LOADER is an experimental feature and might change at any time",
    );
    expect(isSuppressedWarning(warning)).toBe(true);
  });

  it("rejects experimental warnings about other features", () => {
    expect(isSuppressedWarning(experimentalWarning("some other feature is experimental"))).toBe(
      false,
    );
  });

  it("rejects non-experimental warnings mentioning the marker", () => {
    const warning = Object.assign(new Error("vm.USE_MAIN_CONTEXT_DEFAULT_LOADER failed"), {
      name: "Error",
    });
    expect(isSuppressedWarning(warning)).toBe(false);
  });

  it("rejects warnings without the marker", () => {
    expect(isSuppressedWarning(new Error("plain warning"))).toBe(false);
  });
});
