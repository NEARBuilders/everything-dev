import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { readSessionHandle } from "../auth/session";
import { auditSessionPlane } from "../resolution/plane-audit";
import { type PlaneAuditLine, slotPublishKey } from "../resolution/release-plane";
import type { ResolutionSession } from "../resolution/session";
import { findWorkspaceRoot } from "../workspace/workspace";

/**
 * The owned-slot realignment (the "run bos plugin publish …" repair, executed):
 * after an upgrade moves the framework version, owned slots built against the
 * old chain keep stale shared-singleton pins in the child's published config —
 * the divergence the dev audit reports and the #546 boot guard eventually
 * refuses. The upgrade closes the loop itself: audit the freshly resolved
 * plane, and for every owned slot still diverging, republish it through the
 * scoped deploy train (`bos deploy --packages <keys>`) from the newly
 * installed package.
 *
 * Best-effort by construction: no stored publish session skips the leg (the
 * repair stays a printed instruction), a failed republish is reported but
 * never fails the upgrade — the plane audit on the next `bos dev` still names
 * what remains.
 */

export interface OwnedRealignment {
  /** Publish keys the audit found diverging (before any republish attempt). */
  keys: string[];
  /** Publish keys that republished successfully. */
  realigned: string[];
  failures: Array<{ key: string; error: string }>;
}

const ownedKeysFrom = (lines: readonly PlaneAuditLine[]): string[] =>
  [
    ...new Set(
      lines.filter((line) => line.kind === "owned").map((line) => slotPublishKey(line.slot)),
    ),
  ].sort();

/** Detect owned slots the freshly resolved plane still finds diverging. */
export async function detectOwnedDivergentKeys(
  session: NonNullable<ResolutionSession>,
  options?: { fetchImpl?: typeof fetch },
): Promise<{ keys: string[]; lines: PlaneAuditLine[] }> {
  const lines = await auditSessionPlane(session, options);
  return { keys: ownedKeysFrom(lines), lines };
}

/**
 * Republish `keys` through the scoped deploy train, running the freshly
 * installed bos binary. Output is forwarded to stderr — the migration phase
 * runs under `--json` re-exec, where stdout is the structured result.
 */
export async function realignOwnedSlots(
  projectDir: string,
  keys: readonly string[],
  log: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): Promise<OwnedRealignment> {
  const realigned: string[] = [];
  const failures: OwnedRealignment["failures"] = [];

  if (!existsSync(join(projectDir, ".bos", "session.json"))) {
    log(
      `  [realign] No stored CLI session in .bos/ — skipping the owned-slot republish of ${keys.join(", ")}. Run \`bos login\`, then: bos deploy --packages ${keys.join(",")}`,
    );
    return { keys: [...keys], realigned, failures };
  }

  const workspaceDir = findWorkspaceRoot(projectDir)?.dir ?? projectDir;
  const bosBin = join(workspaceDir, "node_modules", ".bin", "bos");
  if (!existsSync(bosBin)) {
    log(`  [realign] bos binary not found at ${bosBin} — skipping the owned-slot republish`);
    return { keys: [...keys], realigned, failures };
  }

  log(`  [realign] Republishing owned slots built against the old chain: ${keys.join(", ")}`);
  const child = spawnSync(bosBin, ["deploy", "--packages", keys.join(",")], {
    cwd: projectDir,
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf-8",
    env: { ...process.env, BOS_NO_BANNER: "1" },
  });
  if (child.stdout) process.stderr.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);

  if (child.status === 0) {
    realigned.push(...keys);
  } else {
    failures.push({
      key: keys.join(","),
      error: `bos deploy --packages exited ${child.status ?? "n/a"}`,
    });
    log(`  [realign] Republish failed — realign by hand: bos deploy --packages ${keys.join(",")}`);
  }
  return { keys: [...keys], realigned, failures };
}
