export interface SealedBox {
  seal(plaintext: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

async function deriveAesKey(salt: string, secret: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      info: new Uint8Array(0),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function createSealedBox(salt: string, secret: string): SealedBox {
  const key = deriveAesKey(salt, secret);
  return {
    async seal(plaintext) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await key,
        new TextEncoder().encode(plaintext),
      );
      return `${Buffer.from(iv).toString("base64url")}.${Buffer.from(encrypted).toString("base64url")}`;
    },
    async open(sealed) {
      const [iv, encrypted] = sealed.split(".");
      if (!iv || !encrypted) {
        throw new Error("Malformed sealed box ciphertext");
      }
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: Buffer.from(iv, "base64url") },
        await key,
        Buffer.from(encrypted, "base64url"),
      );
      return new TextDecoder().decode(decrypted);
    },
  };
}
