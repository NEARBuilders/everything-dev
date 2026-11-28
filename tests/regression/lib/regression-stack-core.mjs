import { createHash } from "node:crypto";

export const computeStamp = ({ headSha, diff, dockerfile, compose, lockfile, environment }) => {
  const hash = createHash("sha1");
  hash.update([headSha, diff, dockerfile, compose, lockfile, environment].join("\n") + "\n");
  return hash.digest("hex");
};

export const stackName = (variant, stamp) => `bos-regression-${variant}-${stamp.slice(0, 8)}`;

export const reapPlan = (variant, stamp, containers) => {
  const exactName = stackName(variant, stamp);
  const keep = containers.filter((c) => c.name === exactName && c.healthy);
  const reap = containers.filter((c) => !keep.includes(c));
  return { keep, reap };
};
