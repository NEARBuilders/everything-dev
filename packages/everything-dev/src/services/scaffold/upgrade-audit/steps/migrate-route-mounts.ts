import { Effect } from "effect";
import { KNOWN_MOUNTS, MOUNT_ALIASES } from "../domain";
import { fileExists, listFiles, readText, removePath, writeText } from "../fs";
import { UPSTREAM_REF } from "../upstream-ref";
import type { StepResult } from "./author-config";

const ROUTES_GLOB = "ui/src/routes/**/*.{ts,tsx}";
const ROUTE_FILE_RE = /createFileRoute(?:<[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/;

/**
 * Unknown mount id → registered mount id. Child apps commonly root their UI
 * under `_layout` (v1 convention) which is not in the host mount registry.
 * Map it to `_public` by default; individual entries can be overridden.
 */
const MOUNT_REDIRECTS: Record<string, string> = {
  layout: "public",
};

const mountIdOf = (routePath: string): string | null => {
  const segments = routePath.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0];
  if (!first.startsWith("_")) return null;
  return first.slice(1);
};

const canonicalMount = (mountId: string): string => MOUNT_ALIASES[mountId] ?? mountId;

const isRegistered = (mountId: string): boolean =>
  KNOWN_MOUNTS.includes(mountId as (typeof KNOWN_MOUNTS)[number]);

const mountLayoutFile = (mountId: string): string => `ui/src/routes/_${mountId}.tsx`;

const renderMountLayout = (mountId: string): string => {
  const canonical = canonicalMount(mountId);
  const needsGate = canonical === "authenticated";
  return [
    "/**",
    " * GENERATED mount layout — a minimal Outlet shell (plus the requireSession",
    " * gate on authed mounts) so rehomed routes sit on a registered mount.",
    " *",
    ` * Upstream canonical shapes live in everything-dev's`,
    ` * upgrade-audit fixtures/upstream/routes/ at UPSTREAM_REF ${UPSTREAM_REF}`,
    " * — conform to those when adding chrome (headers, session context) to",
    " * this mount. Chrome from the old layout was NOT carried over; port it",
    " * manually.",
    " */",
    "",
    `import { createFileRoute, Outlet${needsGate ? ", redirect" : ""} } from "@tanstack/react-router";`,
    needsGate ? `import { requireSession } from "@/lib/auth";` : "",
    "",
    "export const Route = createFileRoute(",
    `  "/_${canonical}",`,
    needsGate ? "  { beforeLoad: requireSession, component: Outlet }," : "  { component: Outlet },",
    "});",
    "",
  ]
    .filter(Boolean)
    .join("\n");
};

const rehomeRoute = (
  file: string,
  source: string,
  targetMount: string,
): { next: string; newFile: string } | null => {
  const match = source.match(ROUTE_FILE_RE);
  if (!match) return null;
  const oldPath = match[1];
  const segments = oldPath.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  // segments[0] is the old mount (e.g. "_layout")
  const oldMountDir = `_${segments[0].slice(1)}`;

  // Build the new route path: drop the old mount segment. If the next segment
  // is itself a registered mount (e.g. /_layout/_authenticated/dashboard),
  // it becomes the new mount; otherwise prepend the target mount.
  let newPathSegments: string[];
  if (segments.length >= 2 && segments[1].startsWith("_")) {
    const segMountId = segments[1].slice(1);
    const canonical = canonicalMount(segMountId);
    if (KNOWN_MOUNTS.includes(canonical as (typeof KNOWN_MOUNTS)[number])) {
      newPathSegments = [`_${canonical}`, ...segments.slice(2)];
    } else {
      newPathSegments = [`_${targetMount}`, ...segments.slice(1)];
    }
  } else {
    newPathSegments = [`_${targetMount}`, ...segments.slice(1)];
  }
  const newPath =
    "/" +
    newPathSegments.join("/") +
    (oldPath.endsWith("/") && newPathSegments.length >= 1 ? "/" : "");
  const next = source.replace(match[0], match[0].replace(oldPath, newPath));

  // New file location: drop the old mount directory. If the next directory is
  // already the right mount, keep it; otherwise insert the target mount dir.
  const parts = file.split("/");
  const mountIdx = parts.indexOf(oldMountDir);
  if (mountIdx === -1) return null;

  let insertTargetMount = true;
  if (mountIdx + 1 < parts.length) {
    const nextSeg = parts[mountIdx + 1];
    if (nextSeg.startsWith("_")) {
      const nextMountId = nextSeg.slice(1);
      const canonical = canonicalMount(nextMountId);
      if (KNOWN_MOUNTS.includes(canonical as (typeof KNOWN_MOUNTS)[number])) {
        insertTargetMount = false;
      }
    }
  }

  const newParts = insertTargetMount
    ? [...parts.slice(0, mountIdx), `_${targetMount}`, ...parts.slice(mountIdx + 1)]
    : [...parts.slice(0, mountIdx), ...parts.slice(mountIdx + 1)];
  const newFile = newParts.join("/");

  return { next, newFile };
};

export const migrateRouteMounts = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const deletes: string[] = [];
    const notes: string[] = [];

    const files = (yield* listFiles(projectDir, ROUTES_GLOB)).filter(
      (f) => !f.endsWith(".test.ts"),
    );

    // Collect files whose route path is under an unknown mount
    const rehome: Array<{ file: string; source: string; targetMount: string }> = [];

    for (const file of files) {
      const source = yield* readText(projectDir, file);
      const match = source.match(ROUTE_FILE_RE);
      if (!match) continue;
      const segments = match[1].split("/").filter(Boolean);
      if (segments.length === 0) continue;
      const mountId = mountIdOf(match[1]);
      if (!mountId || isRegistered(mountId)) continue;

      // Target mount precedence: the mount's own canonical alias
      // (e.g. _auth → authenticated), then a registered mount found in later
      // path segments (e.g. /_layout/_authenticated/dashboard → _authenticated),
      // then MOUNT_REDIRECTS, then "public".
      let targetMount = "public";
      const ownCanonical = canonicalMount(mountId);
      if (KNOWN_MOUNTS.includes(ownCanonical as (typeof KNOWN_MOUNTS)[number])) {
        targetMount = ownCanonical;
      } else {
        for (let i = 1; i < segments.length; i++) {
          const seg = segments[i];
          if (!seg.startsWith("_")) continue;
          const segMountId = seg.slice(1);
          const canonical = canonicalMount(segMountId);
          if (KNOWN_MOUNTS.includes(canonical as (typeof KNOWN_MOUNTS)[number])) {
            targetMount = canonical;
            break;
          }
        }
        if (targetMount === "public" && MOUNT_REDIRECTS[mountId]) {
          targetMount = MOUNT_REDIRECTS[mountId];
        }
      }
      rehome.push({ file, source, targetMount });
    }

    if (rehome.length === 0) {
      notes.push("no routes on unknown mounts — nothing to rehome");
      return { writes, deletes, notes };
    }

    // Create mount layout files for each target mount
    const targetMounts = [...new Set(rehome.map((r) => r.targetMount))];
    for (const targetMount of targetMounts) {
      const path = mountLayoutFile(targetMount);
      if (yield* fileExists(projectDir, path)) {
        notes.push(`${path} exists — left untouched`);
        continue;
      }
      if (!dryRun) yield* writeText(projectDir, path, renderMountLayout(targetMount));
      writes.push(path);
      notes.push(`created mount layout ${path}`);
    }

    // Rehome each route file
    for (const { file, source, targetMount } of rehome) {
      const result = rehomeRoute(file, source, targetMount);
      if (!result) {
        notes.push(`${file}: could not parse route path — left for manual rehome`);
        continue;
      }
      const { next, newFile } = result;
      if (next !== source && !dryRun) {
        yield* writeText(projectDir, newFile, next);
      }
      writes.push(newFile);
      if (!dryRun) {
        yield* removePath(projectDir, file);
      }
      deletes.push(file);
      notes.push(`rehomed ${file} → ${newFile}`);
    }

    // Remove old mount layout files and empty mount directories
    for (const mountId of Object.keys(MOUNT_REDIRECTS)) {
      const layoutPath = mountLayoutFile(mountId);
      if (yield* fileExists(projectDir, layoutPath)) {
        if (!dryRun) yield* removePath(projectDir, layoutPath);
        deletes.push(layoutPath);
        notes.push(`removed obsolete mount layout ${layoutPath}`);
      }
    }

    notes.push(
      "mount layouts are minimal Outlet shells — migrate any chrome (Header/Footer, session) from the old layout into the new mount manually",
    );

    return { writes, deletes, notes };
  });
