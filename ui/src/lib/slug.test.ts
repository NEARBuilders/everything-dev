import { describe, expect, it } from "vitest";
import { deriveSlug, generateSlug, suggestAvailableSlug } from "./slug";

describe("generateSlug", () => {
  it("keeps a slug synchronized with the complete source value", () => {
    expect(generateSlug("Chicago")).toBe("chicago");
    expect(generateSlug("Chicago Heights")).toBe("chicago-heights");
    expect(generateSlug("  São Paulo  ")).toBe("s-o-paulo");
  });

  it("preserves a manually edited slug", () => {
    expect(deriveSlug("Chicago Heights", "chicago", false)).toBe("chicago-heights");
    expect(deriveSlug("Chicago Heights", "chi-town", true)).toBe("chi-town");
  });
});

describe("suggestAvailableSlug", () => {
  it("returns the base when it is available", async () => {
    await expect(suggestAvailableSlug("chicago", () => false)).resolves.toBe("chicago");
  });

  it("suffixes the first free number when candidates are taken", async () => {
    const taken = new Set(["chicago", "chicago-2", "chicago-3"]);
    await expect(suggestAvailableSlug("chicago", (slug) => taken.has(slug))).resolves.toBe(
      "chicago-4",
    );
  });

  it("falls back to a time-based suffix after 98 collisions", async () => {
    const result = await suggestAvailableSlug("chicago", () => true);
    expect(result).toMatch(/^chicago-[a-z0-9]+$/);
    expect(result.startsWith("chicago-")).toBe(true);
  });

  it("returns empty for an empty base", async () => {
    await expect(suggestAvailableSlug("", () => false)).resolves.toBe("");
  });
});
