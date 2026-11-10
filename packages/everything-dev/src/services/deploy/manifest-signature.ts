import { createPublicKey, verify } from "node:crypto";
import type { ManifestSignature } from "every-plugin/version-manifest";
import { parseKey, parsePublicKey } from "near-kit";
import { SignatureInvalid } from "../verify/engine";

/**
 * Manifest attribution (ADR 0046 ticket 05): the deploy train signs each
 * slot's version manifest with the runtime's existing publish identity, and
 * the chain walker verifies the signature against the key record published
 * in the on-chain config (`publish.verification.publicKey`). The payload is
 * `signaturePayloadOf(manifest)` — the canonical key-sorted serialization
 * the version-id derivation also uses — so signer and verifier agree on the
 * bytes without depending on the stored document's whitespace.
 */

export type ManifestSigner = (payload: string) => Promise<ManifestSignature>;

/** The payload's signature, made by the explicit publish identity (the
 * NEAR-format secret key the registry write also signs with — env-provided
 * or the keychain credentials file). */
export function signManifestPayload(payload: string, privateKey: string): ManifestSignature {
  const key = parseKey(privateKey);
  const signature = key.sign(new TextEncoder().encode(payload));
  return {
    algorithm: "ed25519",
    publicKey: key.publicKey.toString(),
    value: Buffer.from(signature.data).toString("base64"),
  };
}

/** Verify a manifest's attribution against the config's key record. Throws
 * `SignatureInvalid` naming the failure mode — a missing signature, a
 * foreign key (present in the document but never registered in the config),
 * or a signature that does not verify. */
export function verifyManifestSignature(
  payload: string,
  signature: ManifestSignature | undefined,
  expectedPublicKey: string,
): void {
  const url = "manifest signature";
  if (!signature) {
    throw new SignatureInvalid({
      url,
      reason: "no signature — publish.verification demands attribution",
    });
  }
  if (signature.algorithm !== "ed25519") {
    throw new SignatureInvalid({
      url,
      reason: `unsupported signature algorithm ${signature.algorithm}`,
    });
  }
  const expected = nearKeyString(expectedPublicKey);
  if (nearKeyString(signature.publicKey) !== expected) {
    throw new SignatureInvalid({
      url,
      reason: `signed by unregistered key ${signature.publicKey} — the config's key record names ${expected}`,
    });
  }
  const signatureBytes = Buffer.from(signature.value, "base64");
  if (signatureBytes.length !== 64) {
    throw new SignatureInvalid({
      url,
      reason: `signature value is ${signatureBytes.length} bytes — ed25519 signatures are 64`,
    });
  }
  const verified = verify(
    null,
    new TextEncoder().encode(payload),
    ed25519PublicKeyObject(expected),
    signatureBytes,
  );
  if (!verified) {
    throw new SignatureInvalid({
      url,
      reason: "signature does not verify against the key record",
    });
  }
}

/** Wrap a NEAR-format ed25519 public key (`ed25519:<base58>`) into the DER
 * SubjectPublicKeyInfo form node:crypto's `verify` consumes. */
function ed25519PublicKeyObject(nearKey: string) {
  const parsed = parsePublicKey(nearKey);
  if (parsed.keyType !== 0) {
    throw new SignatureInvalid({
      url: "manifest signature",
      reason: `key record is not ed25519 (keyType ${parsed.keyType})`,
    });
  }
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(parsed.data),
  ]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

/** Accept the key record in either NEAR format (`ed25519:<base58>`) or bare
 * base58 — the config is hand-authored. */
export function nearKeyString(key: string): string {
  return key.includes(":") ? key : `ed25519:${key}`;
}

/** Train-time guard: the identity about to sign must be the identity the
 * config's key record names — a mismatch fails the deploy before anything
 * uploads (the record and the signer drifting apart is exactly the
 * attribution gap). */
export function assertSigningIdentityMatches(
  signingPublicKey: string,
  expectedPublicKey: string,
): void {
  const expected = nearKeyString(expectedPublicKey);
  if (nearKeyString(signingPublicKey) !== expected) {
    throw new Error(
      `Manifest attribution mismatch: the publish identity signs with ${signingPublicKey} ` +
        `but publish.verification.publicKey names ${expected}. Update the config's key record ` +
        "(rotation is a config publish) or sign with the recorded identity.",
    );
  }
}
