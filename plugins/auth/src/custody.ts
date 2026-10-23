import { randomUUID } from "node:crypto";
import { OutlayerClient } from "@outlayer/sdk";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./db/layer";
import * as schema from "./db/schema";
import { createSealedBox } from "./sealed-box";

const KEY_SALT = "everything-dev-custody-wallet";
const NETWORKS = ["mainnet", "testnet"] as const;

const registerBody = z.object({
  network: z.enum(NETWORKS).optional(),
});

const credentialSummary = {
  walletId: schema.custodyWallet.walletId,
  nearAccountId: schema.custodyWallet.nearAccountId,
  handoffUrl: schema.custodyWallet.handoffUrl,
} as const;

export function custody(db: Database, secret: string, defaultNetwork: (typeof NETWORKS)[number]) {
  const box = createSealedBox(KEY_SALT, secret);
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
            .select(credentialSummary)
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
          const [row] = await db
            .insert(schema.custodyWallet)
            .values({
              id: randomUUID(),
              userId: user.id,
              network,
              walletId: registered.wallet_id,
              nearAccountId: registered.near_account_id,
              handoffUrl: registered.handoff_url ?? null,
              encryptedApiKey: await box.seal(registered.api_key),
            })
            .returning(credentialSummary);
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
            apiKey: await box.open(row.encryptedApiKey),
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
