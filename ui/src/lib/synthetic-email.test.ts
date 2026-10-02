import { describe, expect, it } from "vitest";
import { isSyntheticEmail } from "./synthetic-email";

describe("isSyntheticEmail", () => {
  it("treats passkey signup addresses as synthetic", () => {
    expect(isSyntheticEmail("passkey-a1b2c3d4@v1.citynode.near")).toBe(true);
    expect(isSyntheticEmail("PASSKEY-A1B2C3D4@example.com")).toBe(true);
  });

  it("treats SIWN temp addresses as synthetic", () => {
    expect(isSyntheticEmail("temp-abc123@v1.citynode.near")).toBe(true);
    expect(isSyntheticEmail("temp-deadbeef@auth.everything.near")).toBe(true);
  });

  it("treats @near.email addresses as synthetic (not deliverable)", () => {
    expect(isSyntheticEmail("alice@near.email")).toBe(true);
    expect(isSyntheticEmail("bob@NEAR.EMAIL")).toBe(true);
  });

  it("treats missing/empty addresses as synthetic", () => {
    expect(isSyntheticEmail(null)).toBe(true);
    expect(isSyntheticEmail(undefined)).toBe(true);
    expect(isSyntheticEmail("")).toBe(true);
  });

  it("treats real user-supplied emails as non-synthetic", () => {
    expect(isSyntheticEmail("elliot@citynode.app")).toBe(false);
    expect(isSyntheticEmail("someone@example.com")).toBe(false);
    expect(isSyntheticEmail("passkey-team@example.com")).toBe(false);
    expect(isSyntheticEmail("passkey-abc@example.com")).toBe(false);
  });
});
