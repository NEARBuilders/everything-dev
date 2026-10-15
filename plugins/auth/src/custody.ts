import { randomUUID } from "node:crypto";
import { OutlayerClient } from "@outlayer/sdk";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./db";
import * as schema from "./db/schema";

const KEY_SALT = "everything-dev-custody-wallet";
const NETWORKS = ["mainnet", "testnet"] as const;
type NearNetwork = (typeof NETWORKS)[number];

const registerBody = z.object({
  network: z.enum(NETWORKS).optional(),
});

async function deriveAesKey(secret: string): Promise<CryptoKey> {
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
      salt: new TextEncoder().encode(KEY_SALT),
      info: new Uint8Array(0),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealApiKey(secret: string, apiKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deriveAesKey(secret),
    new TextEncoder().encode(apiKey),
  );
  return {
    encryptedApiKey: `${Buffer.from(iv).toString("base64url")}.${Buffer.from(encrypted).toString("base64url")}`,
    iv: Buffer.from(iv).toString("base64url"),
  };
}

export async function openApiKey(secret: string, sealed: { encryptedApiKey: string; iv: string }) {
  const [iv, encrypted] = sealed.encryptedApiKey.split(".");
  if (!iv || !encrypted) throw new Error("Malformed custody wallet ciphertext");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64url") },
    await deriveAesKey(secret),
    Buffer.from(encrypted, "base64url"),
  );
  return new TextDecoder().decode(decrypted);
}

export function custody(db: Database, secret: string, defaultNetwork: NearNetwork) {
  return {
    id: "custody",
    endpoints: {
      registerCustodyWallet: createAuthEndpoint(
        "/custody/register",
        { method: "POST", body: registerBody, use: [sessionMiddleware] },
        async (ctx) => {
          const { user } = ctx.context.session;
          const network = ctx.body.network ?? defaultNetwork;
          const [existing] = await db
            .select({
              walletId: schema.custodyWallet.walletId,
              nearAccountId: schema.custodyWallet.nearAccountId,
              handoffUrl: schema.custodyWallet.handoffUrl,
            })
            .from(schema.custodyWallet)
            .where(
              and(
                eq(schema.custodyWallet.userId, user.id),
                eq(schema.custodyWallet.network, network),
              ),
            )
            .limit(1);
          if (existing) {
            return ctx.json({ registered: false, network, ...existing });
          }
          const registered = await OutlayerClient.register({ network });
          if (!registered.api_key) {
            throw new APIError("BAD_GATEWAY", {
              message: "OutLayer wallet registration returned no API key",
            });
          }
          const sealed = await sealApiKey(secret, registered.api_key);
          const [row] = await db
            .insert(schema.custodyWallet)
            .values({
              id: randomUUID(),
              userId: user.id,
              network,
              walletId: registered.wallet_id,
              nearAccountId: registered.near_account_id,
              handoffUrl: registered.handoff_url ?? null,
              ...sealed,
            })
            .returning({
              walletId: schema.custodyWallet.walletId,
              nearAccountId: schema.custodyWallet.nearAccountId,
              handoffUrl: schema.custodyWallet.handoffUrl,
            });
          return ctx.json({ registered: true, network, ...row });
        },
      ),
      getCustodyCredential: createAuthEndpoint(
        "/custody/credential",
        { method: "POST", body: registerBody, use: [sessionMiddleware] },
        async (ctx) => {
          const { user } = ctx.context.session;
          const network = ctx.body.network ?? defaultNetwork;
          const [row] = await db
            .select()
            .from(schema.custodyWallet)
            .where(
              and(
                eq(schema.custodyWallet.userId, user.id),
                eq(schema.custodyWallet.network, network),
              ),
            )
            .limit(1);
          if (!row) {
            throw new APIError("NOT_FOUND", {
              message: `No custody wallet registered for ${user.id} on ${network}. Approve a bos login with custody provisioning first.`,
            });
          }
          await db
            .update(schema.custodyWallet)
            .set({ lastUsedAt: new Date() })
            .where(eq(schema.custodyWallet.id, row.id));
          return ctx.json({
            apiKey: await openApiKey(secret, row),
            walletId: row.walletId,
            nearAccountId: row.nearAccountId,
            network,
            handoffUrl: row.handoffUrl,
            registeredAt: row.createdAt.toISOString(),
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
