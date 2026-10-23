import { Effect } from "effect";
import { Finding, KNOWN_MOUNTS, MOUNT_ALIASES } from "../domain";
import { listFiles, readText } from "../fs";

const ROUTE_FILE_RE = /createFileRoute(?:<[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/;

const AUTHED_MOUNTS = new Set(["authenticated", "admin", "organization"]);

const SESSION_CALLEES = ["authClient.getSession(", "sessionQueryOptions("];

const firstSegment = (routePath: string): string | null => {
  const segments = routePath.split("/").filter(Boolean);
  return segments.length > 0 ? segments[0] : null;
};

const isLayoutPath = (routePath: string): boolean =>
  routePath.split("/").filter(Boolean).length === 1;

const parseRoutePath = (source: string): string | null => {
  const match = source.match(ROUTE_FILE_RE);
  return match?.[1] ?? null;
};

const checkRoot = (relativePath: string, source: string): Finding[] => {
  const findings: Finding[] = [];
  if (!/<html[\s>]/.test(source)) {
    findings.push(
      new Finding({
        check: "routes",
        path: relativePath,
        severity: "warn",
        message: "root route has no document shell — already thin, graft-ready",
      }),
    );
    return findings;
  }
  findings.push(
    new Finding({
      check: "routes",
      path: relativePath,
      severity: "warn",
      message:
        "root route owns the document shell (<html>) — acceptable today, must become thin (<Outlet />) before the app.ts/grafting model",
    }),
  );
  return findings;
};

const checkRouteFile = (relativePath: string, source: string): Finding[] => {
  if (relativePath.endsWith("__root.tsx")) {
    return checkRoot(relativePath, source);
  }

  const routePath = parseRoutePath(source);
  if (!routePath) {
    return [
      new Finding({
        check: "routes",
        path: relativePath,
        severity: "blocker",
        message: "no createFileRoute() call with a path literal found",
      }),
    ];
  }

  const segment = firstSegment(routePath);
  if (!segment?.startsWith("_")) {
    return [
      new Finding({
        check: "routes",
        path: relativePath,
        severity: "blocker",
        message: `route "/${routePath.replace(/^\//, "")}" is not mounted under a pathless layout — re-home under _<mount>`,
      }),
    ];
  }

  const mountId = segment.slice(1);
  const canonical = MOUNT_ALIASES[mountId] ?? mountId;
  const findings: Finding[] = [];

  if (!KNOWN_MOUNTS.includes(canonical as (typeof KNOWN_MOUNTS)[number])) {
    findings.push(
      new Finding({
        check: "routes",
        path: relativePath,
        severity: "blocker",
        message: `unknown mount "_${mountId}" — not in the host mount registry`,
      }),
    );
    return findings;
  }

  if (
    isLayoutPath(routePath) &&
    AUTHED_MOUNTS.has(canonical) &&
    !/beforeLoad\s*[:(]/.test(source)
  ) {
    findings.push(
      new Finding({
        check: "routes",
        path: relativePath,
        severity: "blocker",
        message: `authed layout "_${mountId}" has no beforeLoad gate — session checks must live on the mount`,
      }),
    );
  }

  if (!isLayoutPath(routePath) && SESSION_CALLEES.some((callee) => source.includes(callee))) {
    findings.push(
      new Finding({
        check: "routes",
        path: relativePath,
        severity: "warn",
        message: "leaf route resolves the session directly — inherit the mount gate instead",
      }),
    );
  }

  return findings;
};

export const checkRoutes = (projectDir: string): Effect.Effect<Finding[], Error> =>
  Effect.gen(function* () {
    const files = (yield* listFiles(projectDir, "ui/src/routes/**/*.{ts,tsx}")).filter(
      (file) => !file.endsWith(".test.ts"),
    );

    if (files.length === 0) {
      return [
        new Finding({
          check: "routes",
          path: "ui/src/routes",
          severity: "blocker",
          message: "no route files found — is this a child app with UI overrides?",
        }),
      ];
    }

    const findings: Finding[] = [];
    for (const file of files) {
      const source = yield* readText(projectDir, file);
      findings.push(...checkRouteFile(file, source));
    }
    return findings;
  });
