import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

export type AuthenticatorCurve = "p256" | "ed25519" | "rsa";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

export interface RegistrationOptionsJSON {
  challenge: string;
  rp: { id?: string };
}

export interface AuthenticationOptionsJSON {
  challenge: string;
  rpId?: string;
}

interface CeremonyOptions {
  origin: string;
  userVerified?: boolean;
}

function sha256(data: Uint8Array | string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function uint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, false);
  return bytes;
}

function jwkBytes(value: string | undefined): Uint8Array {
  return isoBase64URL.toBuffer(value ?? "");
}

function coseKey(curve: AuthenticatorCurve, publicKey: KeyObject): Uint8Array {
  const jwk = publicKey.export({ format: "jwk" });
  if (curve === "rsa") {
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 3],
        [3, -257],
        [-1, jwkBytes(jwk.n)],
        [-2, jwkBytes(jwk.e)],
      ]),
    );
  }
  if (curve === "p256") {
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, jwkBytes(jwk.x)],
        [-3, jwkBytes(jwk.y)],
      ]),
    );
  }
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 1],
      [3, -8],
      [-1, 6],
      [-2, jwkBytes(jwk.x)],
    ]),
  );
}

function flags(userVerified: boolean, attested: boolean): number {
  return (
    FLAG_USER_PRESENT |
    (userVerified ? FLAG_USER_VERIFIED : 0) |
    (attested ? FLAG_ATTESTED_CREDENTIAL : 0)
  );
}

function clientData(type: string, challenge: string, origin: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

export function createSoftwareAuthenticator(curve: AuthenticatorCurve = "p256") {
  const { publicKey, privateKey } =
    curve === "p256"
      ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      : curve === "rsa"
        ? generateKeyPairSync("rsa", { modulusLength: 2048 })
        : generateKeyPairSync("ed25519");
  const credentialId = new Uint8Array(randomBytes(32));
  const credentialIdB64 = isoBase64URL.fromBuffer(credentialId);
  let counter = 0;

  const signData = (data: Uint8Array): Uint8Array<ArrayBuffer> =>
    new Uint8Array(sign(curve === "ed25519" ? null : "sha256", data, privateKey));

  return {
    credentialId: credentialIdB64,

    register(options: RegistrationOptionsJSON, ceremony: CeremonyOptions) {
      const rpId = options.rp.id ?? new URL(ceremony.origin).hostname;
      const authData = concat(
        sha256(rpId),
        new Uint8Array([flags(ceremony.userVerified ?? true, true)]),
        uint32(counter),
        new Uint8Array(16),
        uint16(credentialId.length),
        credentialId,
        coseKey(curve, publicKey),
      );
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, never>>([
          ["fmt", "none"],
          ["attStmt", new Map<string, never>()],
          ["authData", authData],
        ]),
      );
      return {
        id: credentialIdB64,
        rawId: credentialIdB64,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(
            clientData("webauthn.create", options.challenge, ceremony.origin),
          ),
          attestationObject: isoBase64URL.fromBuffer(new Uint8Array(attestationObject)),
          transports: ["internal"],
        },
      };
    },

    authenticate(options: AuthenticationOptionsJSON, ceremony: CeremonyOptions) {
      counter += 1;
      const rpId = options.rpId ?? new URL(ceremony.origin).hostname;
      const authData = concat(
        sha256(rpId),
        new Uint8Array([flags(ceremony.userVerified ?? true, false)]),
        uint32(counter),
      );
      const clientDataJSON = clientData("webauthn.get", options.challenge, ceremony.origin);
      const signature = signData(concat(authData, sha256(clientDataJSON)));
      return {
        id: credentialIdB64,
        rawId: credentialIdB64,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
          authenticatorData: isoBase64URL.fromBuffer(authData),
          signature: isoBase64URL.fromBuffer(signature),
        },
      };
    },
  };
}
