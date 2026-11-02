import { Context, Effect, Layer } from "effect";

/**
 * Grant-token vault — `ngt_` tokens are encrypted at rest (HKDF-SHA256 →
 * AES-256-GCM, plugin-specific salt) and never leave the server. The
 * commitment (sha256 of the token) is the only thing that reaches the
 * owner-signed intent.
 */

const VAULT_SALT = "agent-connect-grant-vault";

export interface SealedToken {
  ciphertext: string;
  iv: string;
}

export class GrantVault extends Context.Service<GrantVault, GrantVaultShape>()(
  "agent-connect/GrantVault",
) {}

export interface GrantVaultShape {
  seal(token: string): Effect.Effect<SealedToken, Error>;
  open(sealed: SealedToken): Effect.Effect<string, Error>;
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HKDF",
    },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(VAULT_SALT),
      info: new Uint8Array(0),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export const grantVaultLayer = (secret: string): Layer.Layer<GrantVault> => {
  const keyPromise = deriveAesKey(secret);

  const vault: GrantVaultShape = {
    seal: (token) =>
      Effect.tryPromise({
        try: async (): Promise<SealedToken> => {
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const encrypted = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            await keyPromise,
            new TextEncoder().encode(token),
          );
          return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
        },
        catch: (cause) => new Error("Failed to seal grant token", { cause }),
      }),
    open: ({ ciphertext, iv }) =>
      Effect.tryPromise({
        try: async (): Promise<string> => {
          const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToBytes(iv) as Uint8Array<ArrayBuffer> },
            await keyPromise,
            base64ToBytes(ciphertext) as Uint8Array<ArrayBuffer>,
          );
          return new TextDecoder().decode(decrypted);
        },
        catch: (cause) => new Error("Failed to open grant token", { cause }),
      }),
  };

  return Layer.succeed(GrantVault, vault);
};
