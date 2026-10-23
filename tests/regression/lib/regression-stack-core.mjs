/**
 * Pure helpers for the regression stack lifecycle (ADR 0009 amendment) —
 * imported by both the CLI (regression-stack.mjs) and the unit suite.
 * Process-spawning and health probing stay in the CLI module; everything
 * here is a pure function of its arguments.
 */
import { createHash } from "node:crypto";

/**
 * Content stamp: everything the built fixture depends on, hashed together.
 * - headSha — the committed source state the docker context carries
 * - diff — uncommitted source changes (same effect as a new HEAD)
 * - dockerfile / docker-compose / lockfile — fixture image + dependency graph
 * - environment — base port + DB URLs: a port drift re-stamps without
 *   touching sources
 * Untracked-but-ignored noise (`.bos/`, `node_modules`, dist) is excluded on
 * purpose: it is runtime state or build output, not code truth.
 */
export const computeStamp = ({ headSha, diff, dockerfile, compose, lockfile, environment }) => {
  const hash = createHash("sha1");
  hash.update([headSha, diff, dockerfile, compose, lockfile, environment].join("\n") + "\n");
  return hash.digest("hex");
};

export const stackName = (variant, stamp) => `bos-regression-${variant}-${stamp.slice(0, 8)}`;

/**
 * Reap planner: given the live containers for a variant ({name, healthy})
 * and the current stamp, decide what to keep (at most one healthy container
 * matching the current stamp) and what to reap (everything else, including
 * extra same-stamp duplicates).
 */
export const reapPlan = (variant, stamp, containers) => {
  const exactName = stackName(variant, stamp);
  const keep = containers.filter((c) => c.name === exactName && c.healthy);
  const reap = containers.filter((c) => !keep.includes(c));
  return { keep, reap };
};
