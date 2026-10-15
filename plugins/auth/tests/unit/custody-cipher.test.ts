import { describe, expect, it } from "vitest";
import { openApiKey, sealApiKey } from "../../src/custody";

describe("custody wallet api key sealing", () => {
  const secret = "test-secret";

  it("round-trips the wk_ key", async () => {
    const sealed = await sealApiKey(secret, "wk_abc123");
    expect(sealed.encryptedApiKey).not.toContain("wk_abc123");
    expect(sealed.iv).toBeTruthy();
    await expect(openApiKey(secret, sealed)).resolves.toBe("wk_abc123");
  });

  it("refuses to open with the wrong secret", async () => {
    const sealed = await sealApiKey(secret, "wk_abc123");
    await expect(openApiKey("other-secret", sealed)).rejects.toThrow();
  });

  it("refuses malformed ciphertext", async () => {
    await expect(openApiKey(secret, { encryptedApiKey: "garbage", iv: "iv" })).rejects.toThrow(
      "Malformed custody wallet ciphertext",
    );
  });
});
