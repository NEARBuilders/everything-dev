import { Effect } from "effect";
import { fileExists, readText, removePath, writeText } from "../fs";
import { RETIRED_STUB_FILES } from "../obsolete-files";
import type { StepResult } from "./author-config";

const RSBUILD_PATH = "ui/rsbuild.config.ts";

/**
 * Retires the v1 hand-written UI shells once the generated stubs can take
 * over (ADR 0023):
 *
 * 1. Rewires `ui/rsbuild.config.ts` so the client build entry, the
 *    `./Hydrate` federation expose, the SSR build entry, and the server
 *    `./Router` expose all point at the generated stubs
 *    (`hydrate.gen.tsx` / `router.server.gen.tsx`) instead of the
 *    hand-written shells.
 * 2. Deletes each retired shell only when its generated replacement exists
 *    AND no build config reference remains — they are live build entries on
 *    a v1 tree, so both guards are required.
 *
 * The generated stubs import `everything-dev/ui/hydrate` /
 * `everything-dev/ui/router-server` / `everything-dev/ui/entry`, which are
 * only published by v2 framework releases. The apply train pins the v2
 * catalog (migrate-pnpm) before this step, so resolution succeeds after
 * the post-apply install.
 */

const rewireConfig = (source: string): { next: string; changes: number } => {
  let changes = 0;
  let next = source;
  for (const [from, to] of [
    ["./src/hydrate.tsx", "./src/hydrate.gen.tsx"],
    ["./src/router.server.tsx", "./src/router.server.gen.tsx"],
  ] as const) {
    if (next.includes(from)) {
      next = next.replaceAll(from, to);
      changes += 1;
    }
  }
  return { next, changes };
};

export const retireV1Shell = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const deletes: string[] = [];
    const notes: string[] = [];

    let configSource: string | null = null;
    const rsbuildExists = yield* fileExists(projectDir, RSBUILD_PATH);
    if (rsbuildExists) {
      const source = yield* readText(projectDir, RSBUILD_PATH);
      const { next, changes } = rewireConfig(source);
      // Use the in-memory rewired source for reference guards so dry-run
      // previews see the post-rewire state, not the stale disk state.
      configSource = next;
      if (changes > 0) {
        if (!dryRun) yield* writeText(projectDir, RSBUILD_PATH, next);
        writes.push(RSBUILD_PATH);
        notes.push(
          `rsbuild config rewired: ${changes} entry/expose reference(s) moved onto the generated stubs (hydrate.gen.tsx / router.server.gen.tsx)`,
        );
      } else {
        notes.push("rsbuild config references no v1 shell paths — left untouched");
      }
    } else {
      notes.push("ui/rsbuild.config.ts absent — no entry rewiring possible");
    }

    for (const [retired, replacement] of Object.entries(RETIRED_STUB_FILES)) {
      const retiredExists = yield* fileExists(projectDir, retired);
      if (!retiredExists) {
        notes.push(`${retired} absent — nothing to retire`);
        continue;
      }
      const replacementExists = yield* fileExists(projectDir, replacement);
      if (!replacementExists) {
        notes.push(
          `${retired}: replacement ${replacement} not generated yet — retirement deferred (run \`bos types gen\`)`,
        );
        continue;
      }
      if (configSource !== null) {
        const baseName = retired.slice(retired.lastIndexOf("/") + 1);
        if (configSource.includes(baseName)) {
          notes.push(
            `${retired}: rsbuild config still references ${baseName} — retirement deferred; fix the config first`,
          );
          continue;
        }
      }
      if (!dryRun) yield* removePath(projectDir, retired);
      deletes.push(retired);
      notes.push(`retired ${retired} (replaced by generated stub ${replacement})`);
    }

    return { writes, deletes, notes };
  });
