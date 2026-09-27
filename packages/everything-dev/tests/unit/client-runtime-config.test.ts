import { describe, expect, it } from "vitest";
import { ClientRuntimeConfigSchema } from "../../src/types";

describe("ClientRuntimeConfigSchema.rpcBase", () => {
  it("accepts root-prefixed paths", () => {
    expect(ClientRuntimeConfigSchema.shape.rpcBase.parse("/api/rpc")).toBe("/api/rpc");
  });

  it("rejects paths missing the leading slash", () => {
    expect(() => ClientRuntimeConfigSchema.shape.rpcBase.parse("api/rpc")).toThrow();
    expect(() => ClientRuntimeConfigSchema.shape.rpcBase.parse("")).toThrow();
  });
});
