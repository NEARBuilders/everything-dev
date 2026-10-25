import { generateKeyPairSync } from "node:crypto";
import type { AuthContext } from "@better-auth/core";
import { base64, base64url } from "@scure/base";
import { linkPasskeyWalletFromCredential } from "better-near-auth";
import { describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { createTestServices, createTestUser } from "../helpers";

function coseForP256(x: Uint8Array, y: Uint8Array): Uint8Array {
  return new Uint8Array([
    0xa5,
    0x01,
    0x02,
    0x03,
    0x26,
    0x20,
    0x01,
    0x21,
    0x58,
    0x20,
    ...x,
    0x22,
    0x58,
    0x20,
    ...y,
  ]);
}

function generateP256(): { x: Uint8Array; y: Uint8Array } {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  return {
    x: base64url.decode(jwk.x!.padEnd(Math.ceil(jwk.x!.length / 4) * 4, "=")),
    y: base64url.decode(jwk.y!.padEnd(Math.ceil(jwk.y!.length / 4) * 4, "=")),
  };
}

describe("nearAccount (accountId, network) uniqueness", () => {
  it("a concurrent double-link of one NEAR wallet attaches it to only one user", async () => {
    const { services } = await createTestServices();
    const alice = await createTestUser(services, { name: "Alice" });
    const bob = await createTestUser(services, { name: "Bob" });
    const context = (await services.auth.$context) as AuthContext;
    const { x, y } = generateP256();
    const credentialPublicKey = base64.encode(coseForP256(x, y));

    const [aliceLink, bobLink] = await Promise.allSettled([
      linkPasskeyWalletFromCredential(context, {
        userId: alice.userId,
        credentialPublicKey,
        network: "mainnet",
      }),
      linkPasskeyWalletFromCredential(context, {
        userId: bob.userId,
        credentialPublicKey,
        network: "mainnet",
      }),
    ]);

    const linked = [aliceLink, bobLink].filter(
      (result) => result.status === "fulfilled" && result.value.status === "linked",
    );
    const refused = [aliceLink, bobLink].filter((result) => result.status === "rejected");

    expect(linked).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const refusal = String((refused[0] as PromiseRejectedResult).reason);
    expect(refusal).toContain("already linked");

    const derivedAccountId = (
      linked[0] as PromiseFulfilledResult<
        Extract<Awaited<ReturnType<typeof linkPasskeyWalletFromCredential>>, { status: "linked" }>
      >
    ).value.accountId;
    const rows = await services.db.query.nearAccount.findMany({
      where: (t, { eq }) => eq(t.accountId, derivedAccountId),
    });
    expect(rows).toHaveLength(1);
  }, 30000);

  it("same accountId on a different network is a distinct identity", async () => {
    const { services } = await createTestServices();
    const carol = await createTestUser(services, { name: "Carol" });
    const commonAccountId = "shared-account.near";

    await services.db.insert(schema.nearAccount).values({
      id: crypto.randomUUID(),
      userId: carol.userId,
      accountId: commonAccountId,
      network: "testnet",
      publicKey: "ed25519:abcdefghijklmnopqrstuvwxyz0123456789ABCD",
      isPrimary: true,
      createdAt: new Date(),
    });
    await services.db.insert(schema.nearAccount).values({
      id: crypto.randomUUID(),
      userId: carol.userId,
      accountId: commonAccountId,
      network: "mainnet",
      publicKey: "ed25519:abcdefghijklmnopqrstuvwxyz0123456789ABCD",
      isPrimary: false,
      createdAt: new Date(),
    });

    const rows = await services.db.query.nearAccount.findMany({
      where: (t, { eq }) => eq(t.accountId, commonAccountId),
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.network))).toEqual(new Set(["mainnet", "testnet"]));
  });
});
