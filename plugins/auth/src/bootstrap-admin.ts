import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import type { Database } from "./db/layer";
import * as schema from "./db/schema";

export class BootstrapAdminFailure extends Data.TaggedError("BootstrapAdminFailure")<{
  readonly message: string;
}> {}

const BOOTSTRAP_ADMIN_EMAIL = "bootstrap-admin@regression.internal";
const BOOTSTRAP_NAME = "bootstrap-admin";
const BOOTSTRAP_KEY_PREFIX = "api_";
const BOOTSTRAP_KEY_START_LENGTH = 8;

/**
 * The base64url translation of @better-auth/api-key's default key hasher —
 * `createHash("SHA-256").digest(key)` → unpadded base64url — so a row written
 * here validates through the plugin's normal `verifyApiKey` path.
 */
function hashBootstrapKey(secret: string): string {
  return createHash("sha256").update(secret).digest().toString("base64url");
}

const dbQuery = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new BootstrapAdminFailure({
        message: `bootstrap admin step failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

/**
 * Dev/test-only seam (ADR 0038 addendum): when `AUTH_BOOTSTRAP_ADMIN_API_KEY`
 * is set, boot-time seeding via the API needs a platform admin + real API key
 * row before any HTTP helper can run. The inserted key verifies through the
 * stock `x-api-key` → `verifyApiKey` path; nothing else about auth changes.
 *
 * The environment's presence of the secret is the explicit opt-in — no
 * production deployment should ever set this variable (the boot log says so).
 * Any failure here fails plugin init loudly: a regression run with a half
 * bootstrapped admin seam would only fail later, confusingly.
 */
export function ensureBootstrapAdmin({ db, secret }: { db: Database; secret: string }) {
  return Effect.gen(function* () {
    const now = new Date();
    let user = yield* dbQuery(() =>
      db.query.user.findFirst({ where: eq(schema.user.email, BOOTSTRAP_ADMIN_EMAIL) }),
    );

    if (!user) {
      yield* dbQuery(() =>
        db
          .insert(schema.user)
          .values({
            id: randomUUID(),
            name: BOOTSTRAP_NAME,
            email: BOOTSTRAP_ADMIN_EMAIL,
            emailVerified: true,
            role: "admin",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing(),
      );
      user = yield* dbQuery(() =>
        db.query.user.findFirst({ where: eq(schema.user.email, BOOTSTRAP_ADMIN_EMAIL) }),
      );
    }

    if (!user) {
      return yield* new BootstrapAdminFailure({
        message: "bootstrap admin user could not be created",
      });
    }

    const hashed = hashBootstrapKey(secret);
    const existing = yield* dbQuery(() =>
      db.query.apikey.findFirst({ where: eq(schema.apikey.key, hashed) }),
    );

    if (existing) {
      if (
        existing.referenceId === user.id &&
        existing.configId === "user-keys" &&
        existing.enabled !== false
      ) {
        return;
      }
      return yield* new BootstrapAdminFailure({
        message:
          "AUTH_BOOTSTRAP_ADMIN_API_KEY collides with an existing API key — choose a distinct value",
      });
    }

    yield* dbQuery(() =>
      db
        .insert(schema.apikey)
        .values({
          id: randomUUID(),
          configId: "user-keys",
          name: "bootstrap admin",
          start: secret.slice(0, Math.min(BOOTSTRAP_KEY_START_LENGTH, secret.length)),
          referenceId: user.id,
          prefix: BOOTSTRAP_KEY_PREFIX,
          key: hashed,
          enabled: true,
          rateLimitEnabled: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
    );
  });
}
