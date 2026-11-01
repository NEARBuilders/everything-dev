import { Effect } from "effect";
import { Finding } from "../domain";
import { listFiles, readText } from "../fs";

/**
 * Flags session-resolution drift that the redirect-loop class of bug feeds
 * on. Two shapes are wrong:
 *
 * 1. An authed mount (`_authenticated`, `_admin`, `_anon`, `_organization`)
 *    reimplementing session resolution inline (sessionQueryOptions /
 *    authClient.getSession) instead of delegating to requireSession from
 *    "everything-dev/ui/auth" — guards that disagree about the same
 *    ["session"] query key can ping-pong /login ↔ the protected route until
 *    the router's redirect budget is exhausted ("Too many redirects").
 * 2. The root passing the raw context.session through without
 *    resolveSessionFromCache — a stale truthy session can survive sign-out
 *    and resurrect authed state.
 */
const INLINE_RESOLUTION = /sessionQueryOptions\(|authClient\.getSession\(/;

const AUTHED_MOUNTS = new Set(["authenticated", "admin", "anon", "organization"]);

export const checkRouteGuards = (projectDir: string): Effect.Effect<Finding[], Error> =>
  Effect.gen(function* () {
    const files = (yield* listFiles(projectDir, "ui/src/routes/_*.tsx")).filter(
      (file) => !file.endsWith(".test.ts"),
    );

    const findings: Finding[] = [];

    for (const file of files) {
      const source = yield* readText(projectDir, file);
      const mountId = file.match(/ui\/src\/routes\/_([a-z]+)\.tsx$/)?.[1];

      if (mountId === undefined) continue;

      if (AUTHED_MOUNTS.has(mountId) && INLINE_RESOLUTION.test(source)) {
        findings.push(
          new Finding({
            check: "route-guards",
            path: file,
            severity: "warn",
            message: `authed mount "_${mountId}" resolves the session inline (sessionQueryOptions/authClient.getSession) — delegate to requireSession from "everything-dev/ui/auth" so all guards share one resolution semantics`,
          }),
        );
      }
    }

    const rootSource = yield* readText(projectDir, "ui/src/routes/__root.tsx");
    if (/const session = context\.session;/.test(rootSource)) {
      findings.push(
        new Finding({
          check: "route-guards",
          path: "ui/src/routes/__root.tsx",
          severity: "warn",
          message:
            "root passes the raw context.session through — resolve it with resolveSessionFromCache so an explicit signed-out cache entry is honored",
        }),
      );
    }

    return findings;
  });
