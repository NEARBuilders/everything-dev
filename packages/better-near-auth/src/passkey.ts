import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58, base64, base64url } from "@scure/base";

const NEP616_ACCOUNT = /^0s[0-9a-f]{40}$/;
const NEP413_TAG = 2 ** 31 + 413;
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;

/** A wallet must never sign on mere user-presence (a bare touch). */
export function isUserVerified(authenticatorData: Uint8Array): boolean {
  if (authenticatorData.length < 37) return false;
  const flags = authenticatorData[32]!;
  return (flags & FLAG_USER_PRESENT) !== 0 && (flags & FLAG_USER_VERIFIED) !== 0;
}

/** WebAuthn gives DER ECDSA signatures; `w_resolve_auth` expects raw low-S compact. */
export function ecdsaDerToRawLowS(der: Uint8Array): Uint8Array {
  const parsed = p256.Signature.fromBytes(der, "der");
  const order = p256.Point.Fn.ORDER;
  const normalized =
    parsed.s * 2n > order ? new p256.Signature(parsed.r, order - parsed.s) : parsed;
  return normalized.toBytes("compact");
}

export type PasskeyCurve = "p256" | "ed25519";
export type PasskeyWalletNetwork = "mainnet" | "testnet";
type PasskeyPublicKey = { curve: PasskeyCurve; bytes: Uint8Array };

const PASSKEY_WALLET_FACTORIES: Partial<
  Record<PasskeyWalletNetwork, Record<PasskeyCurve, string>>
> = {
  mainnet: {
    p256: "p256-passkey-wallet-contract.trezu.near",
    ed25519: "ed25519-passkey-wallet-contract.trezu.near",
  },
};
const DEFAULT_TIMEOUT_SECS = 3600;

export function getPasskeyWalletFactory(
  network: PasskeyWalletNetwork,
  curve: PasskeyCurve,
): string | null {
  return PASSKEY_WALLET_FACTORIES[network]?.[curve] ?? null;
}

export function isPasskeyWalletAvailable(network: PasskeyWalletNetwork): boolean {
  return PASSKEY_WALLET_FACTORIES[network] !== undefined;
}

export function isDeterministicAccountId(accountId: string): boolean {
  return NEP616_ACCOUNT.test(accountId);
}

class BorshWriter {
  private parts: Uint8Array[] = [];

  writeU8(value: number) {
    this.parts.push(new Uint8Array([value & 0xff]));
  }

  writeU32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.parts.push(bytes);
  }

  writeU64(value: bigint) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    this.parts.push(bytes);
  }

  writeFixedBytes(bytes: Uint8Array) {
    this.parts.push(bytes);
  }

  writeString(value: string) {
    this.writeBytes(new TextEncoder().encode(value));
  }

  writeBytes(bytes: Uint8Array) {
    this.writeU32(bytes.length);
    this.parts.push(bytes);
  }

  toBytes(): Uint8Array {
    const total = this.parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

function publicKeyFromString(value: string): PasskeyPublicKey | null {
  if (value.startsWith("p256:")) {
    const bytes = base58.decode(value.slice(5));
    if (bytes.length !== 33 || !(bytes[0] === 0x02 || bytes[0] === 0x03)) return null;
    return { curve: "p256", bytes };
  }
  if (value.startsWith("ed25519:")) {
    const bytes = base58.decode(value.slice(8));
    if (bytes.length !== 32) return null;
    return { curve: "ed25519", bytes };
  }
  return null;
}

function serializeDefaultWalletState(publicKey: PasskeyPublicKey): Uint8Array {
  const w = new BorshWriter();
  w.writeU8(1);
  w.writeU32(0);
  w.writeFixedBytes(publicKey.bytes);
  w.writeU32(DEFAULT_TIMEOUT_SECS);
  w.writeU64(0n);
  w.writeU32(0);
  w.writeU32(0);
  w.writeU32(0);
  return w.toBytes();
}

function serializeDefaultStateInit(publicKey: PasskeyPublicKey, factoryId: string): Uint8Array {
  const w = new BorshWriter();
  w.writeU8(0);
  w.writeU8(1);
  w.writeString(factoryId);
  const state = serializeDefaultWalletState(publicKey);
  w.writeU32(1);
  w.writeU32(0);
  w.writeU32(state.length);
  w.writeFixedBytes(state);
  return w.toBytes();
}

function deriveAccountId(
  publicKey: PasskeyPublicKey,
  network: PasskeyWalletNetwork = "mainnet",
): string | null {
  const factoryId = getPasskeyWalletFactory(network, publicKey.curve);
  if (!factoryId) return null;
  const hash = keccak_256(serializeDefaultStateInit(publicKey, factoryId));
  return `0s${Array.from(hash.slice(12, 32))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

function nep413PayloadHash(message: string, recipient: string, nonce: Uint8Array): Uint8Array {
  if (nonce.length !== 32) return new Uint8Array(0);
  const w = new BorshWriter();
  w.writeU32(NEP413_TAG);
  w.writeString(message);
  w.writeFixedBytes(nonce);
  w.writeString(recipient);
  w.writeU8(0);
  return sha256(w.toBytes());
}

export function computeNep413Challenge(message: string, recipient: string, nonce: Uint8Array) {
  return nep413PayloadHash(message, recipient, nonce);
}

export function derivePasskeyAccountId(
  publicKey: string,
  network: PasskeyWalletNetwork = "mainnet",
): string | null {
  const key = publicKeyFromString(publicKey);
  return key ? deriveAccountId(key, network) : null;
}

export function passkeyPublicKeyToString(key: PasskeyPublicKey): string {
  return `${key.curve}:${base58.encode(key.bytes)}`;
}

type CborValue = number | Uint8Array | Map<number, CborValue>;

function readCborItem(bytes: Uint8Array, offset: number): [CborValue, number] {
  const initial = bytes[offset]!;
  const major = initial >> 5;
  const info = initial & 0x1f;
  offset += 1;
  const readLength = (): [number, number] => {
    if (info < 24) return [info, offset];
    if (info === 24) return [bytes[offset]!, offset + 1];
    if (info === 25) return [(bytes[offset]! << 8) | bytes[offset + 1]!, offset + 2];
    if (info === 26) {
      return [
        bytes[offset]! * 0x1000000 +
          ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!),
        offset + 4,
      ];
    }
    throw new Error("CBOR: unsupported length");
  };

  if (major === 0) {
    const [value, next] = readLength();
    return [value, next];
  }
  if (major === 1) {
    const [value, next] = readLength();
    return [-1 - value, next];
  }
  if (major === 2) {
    const [length, next] = readLength();
    return [bytes.slice(next, next + length), next + length];
  }
  if (major === 5) {
    const [count, next] = readLength();
    const map: Map<number, CborValue> = new Map();
    let cursor = next;
    for (let i = 0; i < count; i++) {
      const [key, afterKey] = readCborItem(bytes, cursor);
      const [value, afterValue] = readCborItem(bytes, afterKey);
      if (typeof key !== "number") throw new Error("CBOR: non-integer map key");
      map.set(key, value);
      cursor = afterValue;
    }
    return [map, cursor];
  }
  if (major === 7 && info < 20) return [info, offset];
  throw new Error(`CBOR: unsupported major type ${major}`);
}

/** COSE_Key (RFC 8152) → passkey public key. Supports EC2/P-256 and OKP/Ed25519. */
export function parseCosePublicKey(cose: Uint8Array): PasskeyPublicKey | null {
  try {
    const [value] = readCborItem(cose, 0);
    if (!(value instanceof Map)) return null;
    const kty = value.get(1);
    const alg = value.get(3);
    if (kty === 2 && alg === -7) {
      if (value.get(-1) !== 1) return null;
      const x = value.get(-2);
      const y = value.get(-3);
      if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array)) return null;
      return { curve: "p256", bytes: new Uint8Array([0x02 | (y[31]! & 1), ...x]) };
    }
    if (kty === 1 && alg === -8) {
      if (value.get(-1) !== 6) return null;
      const x = value.get(-2);
      if (!(x instanceof Uint8Array) || x.length !== 32) return null;
      return { curve: "ed25519", bytes: x };
    }
    return null;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

interface WalletContractProof {
  authenticator_data: string;
  client_data_json: string;
  signature: string;
}

function parseProof(signature: string): WalletContractProof | null {
  try {
    const json = new TextDecoder().decode(base64.decode(signature));
    const proof = JSON.parse(json) as Partial<WalletContractProof>;
    if (
      typeof proof.authenticator_data !== "string" ||
      typeof proof.client_data_json !== "string" ||
      typeof proof.signature !== "string"
    ) {
      return null;
    }
    return proof as WalletContractProof;
  } catch {
    return null;
  }
}

function parseClientData(clientDataJson: string): { challenge: string; type: string } | null {
  try {
    const data = JSON.parse(clientDataJson) as { challenge?: unknown; type?: unknown };
    if (typeof data.challenge !== "string" || typeof data.type !== "string") return null;
    return { challenge: data.challenge, type: data.type };
  } catch {
    return null;
  }
}

export function verifyPasskeyNep413Signature(args: {
  accountId: string;
  publicKey: string;
  signature: string;
  message: string;
  recipient: string;
  nonce: Uint8Array;
}): boolean {
  const { accountId, publicKey, signature, message, recipient, nonce } = args;

  if (!isDeterministicAccountId(accountId)) return false;
  if (nonce.length !== 32) return false;

  const key = publicKeyFromString(publicKey);
  if (!key) return false;

  if (deriveAccountId(key) !== accountId) return false;

  const proof = parseProof(signature);
  if (!proof) return false;

  const clientData = parseClientData(proof.client_data_json);
  if (!clientData || clientData.type !== "webauthn.get") return false;

  const expectedChallenge = nep413PayloadHash(message, recipient, nonce);
  let challenge: Uint8Array;
  try {
    challenge = base64url.decode(clientData.challenge);
  } catch {
    return false;
  }
  if (!constantTimeEqual(challenge, expectedChallenge)) return false;

  let authData: Uint8Array;
  try {
    authData = base64url.decode(proof.authenticator_data);
  } catch {
    return false;
  }
  if (authData.length < 37) return false;
  if (!isUserVerified(authData)) return false;

  const clientDataBytes = new TextEncoder().encode(proof.client_data_json);
  const signedBytes = new Uint8Array(authData.length + 32);
  signedBytes.set(authData);
  signedBytes.set(sha256(clientDataBytes), authData.length);

  const [curve, sigBase58] = proof.signature.split(":") as [string, string];
  if (curve !== key.curve) return false;

  try {
    const sig = base58.decode(sigBase58);
    if (sig.length !== 64) return false;
    if (key.curve === "p256") {
      return p256.verify(sig, signedBytes, key.bytes, { format: "compact" });
    }
    return ed25519.verify(sig, signedBytes, key.bytes);
  } catch {
    return false;
  }
}
