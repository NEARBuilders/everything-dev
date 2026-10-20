import { Effect } from "effect";
import { fileExists, readText, writeText } from "../fs";
import { UPSTREAM_REF } from "../upstream-ref";
import type { StepResult } from "./author-config";

/**
 * Ports the upstream route-guard patterns onto a v2 child app. Upstream
 * route files already delegate session resolution to the framework guard
 * surface — requireSession on authed mounts, resolveSessionFromCache in
 * the root — which is what keeps every guard on one session semantics and
 * prevents the /login ↔ guarded-route redirect ping-pong ("Too many
 * redirects" is the router's redirect-budget tripwire).
 *
 * Unlike the v1→v2 apply pipeline (gated by the pre-upgrade audit), this
 * step is a maintenance port for post-upgrade trees and runs standalone:
 * `pnpm port-route-guards [--dry-run]`
 *
 * Upstream snapshots: fixtures/upstream/routes/<file> at UPSTREAM_REF.
 *
 * Scope decisions, deliberate divergences from upstream main/HEAD:
 * - `_authenticated`/`_admin` are rewritten whole (tiny, pure delegation).
 * - `__root.tsx` is patched surgically (beforeLoad/loader session wiring
 *   only) — child roots commonly carry app-owned chrome that upstream
 *   lacks, and bos sync does not overwrite hand-placed route bodies.
 * - `_public.tsx` is reference-only (upstream's focused-login /
 *   signed-in-shell form needs a PublicShell API this repo may not have) —
 *   noted, not applied.
 */

const MOUNT_PATH = "ui/src/routes/_authenticated.tsx";
const ADMIN_PATH = "ui/src/routes/_admin.tsx";
const ROOT_PATH = "ui/src/routes/__root.tsx";

const renderAuthenticated = (): string =>
  [
    'import { createFileRoute, Outlet } from "@tanstack/react-router";',
    'import { requireSession } from "@/lib/auth";',
    "",
    'export const Route = createFileRoute("/_authenticated")({',
    "  beforeLoad: requireSession,",
    "  component: AuthenticatedLayout,",
    "});",
    "",
    "// The shell is rendered once by the root route.",
    "function AuthenticatedLayout() {",
    "  return <Outlet />;",
    "}",
    "",
  ].join("\n");

const renderAdmin = (): string =>
  [
    'import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";',
    'import { requireSession } from "@/lib/auth";',
    "",
    'export const Route = createFileRoute("/_admin")({',
    "  beforeLoad: async (args) => {",
    "    const result = await requireSession(args);",
    '    if (result.session.user?.role !== "admin") {',
    '      throw redirect({ to: "/dashboard", search: { restricted: "admin" } });',
    "    }",
    "    return result;",
    "  },",
    "  component: AdminGate,",
    "});",
    "",
    "function AdminGate() {",
    "  return <Outlet />;",
    "}",
    "",
  ].join("\n");

/** Detects the old raw pass-through wiring that must be replaced. */
const hasRawRootSession = (source: string): boolean =>
  /const session = context\.session;/.test(source);

const resolveSessionCacheImport = 'import { resolveSessionFromCache } from "@/lib/auth";\n';

const AUTH_LIB_PATH = "ui/src/lib/auth.ts";

const RESOLVE_SESSION_SOURCE = `/**
 * LOCAL COPY — stand-in for \`resolveSessionFromCache\` in
 * \`everything-dev/ui/auth\` (the upstream canonical source; the main app's
 * ui/src/lib/auth.ts is a pure re-export of it). This local copy exists
 * because the pinned framework release predates the v2 train and does not
 * publish \`ui/auth\`.
 *
 * Semantics to preserve when conforming to upstream:
 *   1. Cache-first — the query cache entry wins over the server-passed
 *      session.
 *   2. An explicit signed-out \`null\` cache entry must be honored (return
 *      null, not the stale context session) — this is the fix for the
 *      sign-out-then-bounce-back redirect-loop class.
 *
 * Exit path (once on a framework version that publishes ui/auth): replace
 * this function and requireSession below with
 *   export { requireSession, resolveSessionFromCache } from "everything-dev/ui/auth";
 * then run \`pnpm run typecheck\`.
 */
export function resolveSessionFromCache(
  queryClient: { getQueryData: (key: unknown[]) => unknown },
  session: SessionData | null | undefined
): SessionData | null {
  const cached = queryClient.getQueryData(sessionQueryKey);
  if (cached !== undefined) return cached as SessionData | null;
  return session ?? null;
}

`;

const REQUIRE_SESSION_SOURCE = `/**
 * LOCAL COPY — stand-in for \`requireSession\` in \`everything-dev/ui/auth\`.
 * See resolveSessionFromCache above for why this local copy exists and how
 * to migrate off it.
 *
 * Semantics to preserve when conforming to upstream: this is the single
 * shared session gate for authed mounts — every guard must delegate here
 * (rather than inlining sessionQueryOptions/authClient.getSession) so all
 * guards share one resolution semantics and cannot disagree into a
 * /login <-> protected-route redirect ping-pong.
 */
export function requireSession(args: {
  context: { session: SessionData | null | undefined };
}): { session: SessionData | null } {
  const session = args.context.session;
  if (!session?.user) {
    throw new Error("No active session");
  }
  return { session };
}

`;

/** Ensures ui/src/lib/auth.ts exports resolveSessionFromCache and requireSession. */
const ensureAuthSurface = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<{ writes: string[]; notes: string[] }, Error> =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const notes: string[] = [];

    const exists = yield* fileExists(projectDir, AUTH_LIB_PATH);
    if (!exists) {
      notes.push(`${AUTH_LIB_PATH} absent — auth surface not injected`);
      return { writes, notes };
    }

    let source = yield* readText(projectDir, AUTH_LIB_PATH);

    const hasResolve = /export\s+function\s+resolveSessionFromCache/.test(source);
    const hasRequire = /export\s+function\s+requireSession/.test(source);

    if (hasResolve && hasRequire) {
      notes.push(`${AUTH_LIB_PATH} already exports resolveSessionFromCache and requireSession`);
      return { writes, notes };
    }

    // Need SessionData type — check if it's imported/defined
    const hasSessionData = /SessionData/.test(source);

    if (!hasSessionData) {
      notes.push(`${AUTH_LIB_PATH}: SessionData type not found — auth surface injection skipped`);
      return { writes, notes };
    }

    if (!hasResolve) {
      source = RESOLVE_SESSION_SOURCE + source;
      writes.push(AUTH_LIB_PATH);
      notes.push(`${AUTH_LIB_PATH}: added resolveSessionFromCache export`);
    }
    if (!hasRequire) {
      source = REQUIRE_SESSION_SOURCE + source;
      writes.push(AUTH_LIB_PATH);
      notes.push(`${AUTH_LIB_PATH}: added requireSession export`);
    }

    if (!dryRun) {
      yield* writeText(projectDir, AUTH_LIB_PATH, source);
    }

    return { writes, notes };
  });

export const portRouteGuards = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const notes: string[] = [];

    const surface = yield* ensureAuthSurface(projectDir, dryRun);
    writes.push(...surface.writes);
    notes.push(...surface.notes);

    for (const [path, render, guardId] of [
      [MOUNT_PATH, renderAuthenticated, "sessionQueryOptions("],
      [ADMIN_PATH, renderAdmin, "sessionQueryOptions("],
    ] as const) {
      const exists = yield* fileExists(projectDir, path);
      if (!exists) {
        notes.push(`${path} absent — nothing to port`);
        continue;
      }
      const source = yield* readText(projectDir, path);
      if (source.includes("requireSession")) {
        notes.push(`${path} already delegates to the framework guard`);
        continue;
      }
      if (!source.includes(guardId))
        notes.push(`${path}: session guard pattern not recognized — replaced anyway`);
      if (!dryRun) yield* writeText(projectDir, path, render());
      writes.push(path);
    }

    const rootExists = yield* fileExists(projectDir, ROOT_PATH);
    if (!rootExists) {
      notes.push(`${ROOT_PATH} absent — nothing to patch`);
    } else {
      let source = yield* readText(projectDir, ROOT_PATH);
      if (/resolveSessionFromCache/.test(source)) {
        notes.push("root session wiring already uses resolveSessionFromCache");
      } else if (!hasRawRootSession(source)) {
        notes.push(
          "root session wiring unrecognized (no `const session = context.session;`) — inspect manually",
        );
      } else {
        // Replace the first raw pass-through (beforeLoad), then the loader's
        // conditional seeding.
        source = source.replace(
          "const session = context.session;",
          "const session = resolveSessionFromCache(context.queryClient, context.session);",
        );

        const loaderPattern =
          /const session = context\.session;\s*if \(session && queryClient\) \{\n\s*queryClient\.setQueryData\(sessionQueryKey, session\);/;
        const loaderReplacement = [
          "const session = resolveSessionFromCache(queryClient, context.session);",
          "",
          "    if (session !== undefined && queryClient) {",
          "      queryClient.setQueryData(sessionQueryKey, session);",
        ].join("\n");
        if (loaderPattern.test(source)) {
          source = source.replace(loaderPattern, loaderReplacement);
          notes.push(
            "root loader: raw pass-through → resolveSessionFromCache with explicit signed-out seeding",
          );
        } else {
          notes.push(
            "root loader pattern not matched — only beforeLoad patched; inspect loader wiring manually",
          );
        }

        if (
          !/resolveSessionFromCache/.test(
            source
              .split("\n")
              .filter((l) => l.startsWith("import"))
              .join("\n"),
          )
        ) {
          source = `${resolveSessionCacheImport}${source}`;
        }
        if (!dryRun) yield* writeText(projectDir, ROOT_PATH, source);
        writes.push(ROOT_PATH);
      }
    }

    notes.push(
      "upstream reference-only: _public.tsx focused-login / signed-in-shell semantics were NOT applied — port separately if the PublicShell API supports it",
      `snapshots pinned at ${UPSTREAM_REF} under fixtures/upstream/routes/`,
    );

    return { writes, deletes: [], notes };
  });
