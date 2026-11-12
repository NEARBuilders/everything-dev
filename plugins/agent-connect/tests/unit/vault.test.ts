import { createHash } from "node:crypto";
import { createGrantCredential, grantCommitment } from "@near-intents-agent-api/sdk";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { GrantVault, grantVaultLayer } from "@/services/vault";

const withVault = (secret: string) =>
  Effect.gen(function* () {
    return yield* GrantVault;
  }).pipe(Effect.provide([grantVaultLayer(secret)]));

describe("grant token vault", () => {
  it("issues ngt_ tokens whose commitment is the sha256 of the token", () => {
    const { token, commitment } = createGrantCredential();
    expect(token).toMatch(/^ngt_[A-Za-z0-9_-]{43}$/);
    expect(commitment).toBe(createHash("sha256").update(token).digest("hex"));
    expect(commitment).toBe(grantCommitment(token));
  });

  it("seals tokens so neither ciphertext nor iv contains the token", async () => {
    const vault = await Effect.runPromise(withVault("test-vault-secret-32-bytes-long!!"));
    const { token } = createGrantCredential();

    const sealed = await Effect.runPromise(vault.seal(token));
    expect(sealed.ciphertext).not.toContain(token);
    expect(sealed.iv).not.toContain(token);
  });

  it("opens sealed tokens only under the same vault secret", async () => {
    const vault = await Effect.runPromise(withVault("test-vault-secret-32-bytes-long!!"));
    const { token } = createGrantCredential();
    const sealed = await Effect.runPromise(vault.seal(token));

    const opened = await Effect.runPromise(vault.open(sealed));
    expect(opened).toBe(token);

    const otherVault = await Effect.runPromise(withVault("a-completely-different-secret-value"));
    await expect(Effect.runPromise(otherVault.open(sealed))).rejects.toThrow();
  });
});
