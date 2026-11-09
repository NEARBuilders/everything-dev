import { describe, expect, it } from "vitest";
import { bosContract } from "../../src/contract";
import bosPlugin from "../../src/plugin";

describe("handler module composition", () => {
  it("composer builds the full router through the real builder", () => {
    const router = new bosPlugin().createRouter({});
    expect(Object.keys(router).sort()).toEqual(Object.keys(bosContract).sort());
  });
});
