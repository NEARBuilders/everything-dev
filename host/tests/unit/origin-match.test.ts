import { describe, expect, it } from "vitest";
import { originMatches } from "../../src/utils/origin-match";

describe("originMatches", () => {
  it("matches exact origins", () => {
    expect(originMatches("https://everything.dev", "https://everything.dev")).toBe(true);
  });

  it("does not match different origins", () => {
    expect(originMatches("https://everything.dev", "https://other.dev")).toBe(false);
  });

  it("ignores trailing slashes and case for exact origins", () => {
    expect(originMatches("https://Everything.dev/", "https://everything.dev")).toBe(true);
  });

  it("matches subdomains through a scheme-ful wildcard", () => {
    expect(originMatches("https://*.everything.dev", "https://foo.everything.dev")).toBe(true);
    expect(originMatches("https://*.everything.dev", "https://a.b.everything.dev")).toBe(true);
  });

  it("does not let a wildcard cover the apex domain", () => {
    expect(originMatches("https://*.everything.dev", "https://everything.dev")).toBe(false);
  });

  it("matches a scheme-less wildcard against the hostname regardless of scheme or port", () => {
    expect(originMatches("*.everything.dev", "https://foo.everything.dev")).toBe(true);
    expect(originMatches("*.everything.dev", "http://foo.everything.dev:3000")).toBe(true);
    expect(originMatches("*.everything.dev", "https://other.dev")).toBe(false);
  });

  it("treats ? as a single character", () => {
    expect(originMatches("https://?.everything.dev", "https://a.everything.dev")).toBe(true);
    expect(originMatches("https://?.everything.dev", "https://ab.everything.dev")).toBe(false);
  });

  it("escapes regex metacharacters in the pattern", () => {
    expect(originMatches("https://a.b", "https://axb")).toBe(false);
    expect(originMatches("https://a.b", "https://a.b")).toBe(true);
  });

  it("fails closed on unusable inputs", () => {
    expect(originMatches("", "https://everything.dev")).toBe(false);
    expect(originMatches("https://*.everything.dev", "")).toBe(false);
    expect(originMatches("https://*.everything.dev", "not a url")).toBe(false);
    expect(originMatches("not a url", "https://everything.dev")).toBe(false);
  });
});
