import { describe, expect, it } from "vitest";
import { createOnboardingCodeCipher } from "../../src/onboarding-code-cipher";
import { createSealedBox } from "../../src/sealed-box";

const BOX_SALT = "spike-salt";
const OTHER_SALT = "citynode-onboarding-code";

describe("sealed box", () => {
  it("round-trips a plaintext", async () => {
    const box = createSealedBox(BOX_SALT, "test-secret");
    const sealed = await box.seal("wk_abc123");
    expect(sealed).not.toContain("wk_abc123");
    await expect(box.open(sealed)).resolves.toBe("wk_abc123");
  });

  it("rejects a seal from a different salt", async () => {
    const sealed = await createSealedBox(BOX_SALT, "test-secret").seal("wk_abc123");
    await expect(createSealedBox(OTHER_SALT, "test-secret").open(sealed)).rejects.toThrow();
  });

  it("rejects a wrong secret", async () => {
    const sealed = await createSealedBox(BOX_SALT, "test-secret").seal("wk_abc123");
    await expect(createSealedBox(BOX_SALT, "other-secret").open(sealed)).rejects.toThrow();
  });

  it("rejects malformed ciphertext", async () => {
    await expect(createSealedBox(BOX_SALT, "k").open("garbage")).rejects.toThrow(
      "Malformed sealed box ciphertext",
    );
  });
});

describe("onboarding code cipher", () => {
  it("keeps its encrypt/decrypt interface over the shared box", async () => {
    const cipher = createOnboardingCodeCipher("test-secret");
    const encrypted = await cipher.encrypt("OC-1234");
    expect(encrypted).not.toContain("OC-1234");
    await expect(cipher.decrypt(encrypted)).resolves.toBe("OC-1234");
  });
});
