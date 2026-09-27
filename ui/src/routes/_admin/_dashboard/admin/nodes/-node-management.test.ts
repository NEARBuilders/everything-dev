import { describe, expect, it } from "vitest";
import { filterNodeRows, parseNodeDetailTab, parseNodeMetadata } from "./-node-management";

describe("node metadata editing", () => {
  it("preserves arbitrary JSON data while saving the description field", () => {
    expect(
      parseNodeMetadata(
        '{"population":2700000,"tags":["city"],"location":{"lat":41.8}}',
        " Chicago ",
      ),
    ).toEqual({
      population: 2700000,
      tags: ["city"],
      location: { lat: 41.8 },
      description: "Chicago",
    });
  });

  it.each([
    "null",
    "[]",
    "42",
    '"text"',
    "{broken",
  ])("rejects invalid or non-object metadata: %s", (raw) => {
    expect(() => parseNodeMetadata(raw, "")).toThrow();
  });

  it("uses the description field to update or remove metadata.description", () => {
    expect(parseNodeMetadata('{"description":"old","population":1}', "new")).toEqual({
      description: "new",
      population: 1,
    });
    expect(parseNodeMetadata('{"description":"old","population":1}', " ")).toEqual({
      population: 1,
    });
  });
});

describe("node list search", () => {
  const rows = [
    { node: { name: "Chicago", slug: "chicago" }, parent: { name: "United States" } },
    { node: { name: "Lahore", slug: "lhr" }, parent: { name: "Pakistan" } },
    { node: { name: "Pakistan", slug: "pakistan" }, parent: undefined },
  ];

  it("returns every row for an empty query", () => {
    expect(filterNodeRows(rows, "  ")).toHaveLength(3);
  });

  it("matches name, slug and parent without case sensitivity", () => {
    expect(filterNodeRows(rows, "CHI").map((row) => row.node.name)).toEqual(["Chicago"]);
    expect(filterNodeRows(rows, "lhr").map((row) => row.node.name)).toEqual(["Lahore"]);
    expect(filterNodeRows(rows, "pakistan").map((row) => row.node.name)).toEqual([
      "Lahore",
      "Pakistan",
    ]);
  });
});

describe("node detail tabs", () => {
  it.each(["overview", "validators", "domains", "profile"])("accepts %s", (tab) => {
    expect(parseNodeDetailTab(tab)).toBe(tab);
  });

  it.each([undefined, "", "bindings", 3])("ignores %s", (tab) => {
    expect(parseNodeDetailTab(tab)).toBeUndefined();
  });
});
