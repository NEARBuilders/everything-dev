import { and, eq, inArray, isNull, lt, notExists, or } from "drizzle-orm";
import { Duration, Effect, Layer, Schedule } from "effect";
import type { Database } from "./db";
import * as schema from "./db/schema";

export const ORPHAN_USER_MAX_AGE_MS = 60 * 60 * 1000;
export const ORPHAN_SWEEP_INTERVAL = Duration.minutes(15);

const PERSONAL_ORGANIZATION_METADATA = JSON.stringify({ isPersonal: true });

export async function sweepOrphanUsers(db: Database, now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - ORPHAN_USER_MAX_AGE_MS);
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.user)
      .where(
        and(
          lt(schema.user.createdAt, cutoff),
          isNull(schema.user.phoneNumber),
          or(isNull(schema.user.isAnonymous), eq(schema.user.isAnonymous, false)),
          notExists(
            tx.select().from(schema.passkey).where(eq(schema.passkey.userId, schema.user.id)),
          ),
          notExists(
            tx
              .select()
              .from(schema.nearAccount)
              .where(eq(schema.nearAccount.userId, schema.user.id)),
          ),
          notExists(
            tx.select().from(schema.account).where(eq(schema.account.userId, schema.user.id)),
          ),
          notExists(
            tx.select().from(schema.session).where(eq(schema.session.userId, schema.user.id)),
          ),
        ),
      )
      .returning({ id: schema.user.id });
    const userIds = deleted.map(({ id }) => id);
    if (userIds.length > 0) {
      await tx
        .delete(schema.organization)
        .where(
          and(
            inArray(schema.organization.slug, userIds),
            eq(schema.organization.metadata, PERSONAL_ORGANIZATION_METADATA),
          ),
        );
    }
    return userIds;
  });
}

export const OrphanSweepLive = (db: Database) =>
  Layer.effectDiscard(
    Effect.tryPromise(() => sweepOrphanUsers(db)).pipe(
      Effect.tap((userIds) =>
        userIds.length > 0
          ? Effect.logInfo(`[Auth] Swept ${userIds.length} abandoned passkey registration(s)`)
          : Effect.void,
      ),
      Effect.catch((error) => Effect.logWarning("[Auth] Orphan user sweep failed", error)),
      Effect.repeat(Schedule.spaced(ORPHAN_SWEEP_INTERVAL)),
      Effect.forkScoped,
    ),
  );
