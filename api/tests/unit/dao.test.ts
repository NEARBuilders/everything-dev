import { describe, expect, it } from "vitest";
import { isExplicitDaoMember, parsePolicyGroupMembers } from "../../src/services/dao";

describe("parsePolicyGroupMembers", () => {
  it("returns the union of all Group role members", () => {
    const policy = {
      roles: [
        { kind: "Everyone", name: "all" },
        { name: "council", kind: { Group: ["alice.near", "bob.near"] } },
        { name: "contributors", kind: { Group: ["bob.near", "carol.near"] } },
        { name: "broken", kind: { NotAGroup: true } },
        { name: "null-kind", kind: null },
      ],
    };

    expect(parsePolicyGroupMembers(policy)).toEqual(
      expect.arrayContaining(["alice.near", "bob.near", "carol.near"]),
    );
    expect(parsePolicyGroupMembers(policy)).toHaveLength(3);
  });

  it("returns an empty array for non-object or missing-roles inputs", () => {
    expect(parsePolicyGroupMembers(null)).toEqual([]);
    expect(parsePolicyGroupMembers(undefined)).toEqual([]);
    expect(parsePolicyGroupMembers({})).toEqual([]);
    expect(parsePolicyGroupMembers({ roles: "nope" })).toEqual([]);
    expect(parsePolicyGroupMembers(42)).toEqual([]);
  });

  it("ignores non-string members and empty strings", () => {
    const policy = {
      roles: [{ name: "x", kind: { Group: ["valid.near", "", null, 42, "other.near"] } }],
    };
    expect(parsePolicyGroupMembers(policy).sort()).toEqual(["other.near", "valid.near"]);
  });
});

describe("isExplicitDaoMember", () => {
  it("returns true when the account is named in any Group role", () => {
    const policy = {
      roles: [{ name: "council", kind: { Group: ["alice.near"] } }],
    };
    expect(isExplicitDaoMember(policy, "alice.near")).toBe(true);
  });

  it("returns false when the account only appears in the Everyone role", () => {
    const policy = { roles: [{ kind: "Everyone", name: "all" }] };
    expect(isExplicitDaoMember(policy, "anyone.near")).toBe(false);
  });

  it("returns false when no roles match", () => {
    const policy = {
      roles: [{ name: "council", kind: { Group: ["alice.near", "bob.near"] } }],
    };
    expect(isExplicitDaoMember(policy, "carol.near")).toBe(false);
  });
});
