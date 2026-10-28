const SEMVER_PATTERN =
  /^(?<core>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[\w.-]+)?$/;

interface ParsedVersion {
  core: readonly number[];
  prerelease: readonly (number | string)[];
}

function parseVersion(version: string | undefined): ParsedVersion | null {
  if (!version) return null;
  const match = SEMVER_PATTERN.exec(version.trim().replace(/^[\^~>=v]+/, ""));
  if (!match?.groups) return null;
  const prerelease = match.groups.prerelease
    ? match.groups.prerelease.split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id))
    : [];
  return {
    core: [Number(match.groups.core), Number(match.groups.minor), Number(match.groups.patch)],
    prerelease,
  };
}

function comparePrerelease(a: ParsedVersion["prerelease"], b: ParsedVersion["prerelease"]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (typeof left === "number" && typeof right === "number") {
      if (left !== right) return left < right ? -1 : 1;
    } else if (typeof left === "number") {
      return -1;
    } else if (typeof right === "number") {
      return 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Semver-ordered comparison of two version strings: -1 when `a` is older than
 * `b`, 1 when newer, 0 when equal. Prerelease-aware per the semver spec
 * ("2.0.0-rc.9" < "2.0.0-rc.10" < "2.0.0"). Unparseable versions compare as
 * equal — a gate must never fire on versions it cannot order.
 */
export function compareSemver(a: string | undefined, b: string | undefined): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < left.core.length; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i]! < right.core[i]! ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

/**
 * Whether `version` satisfies `constraint`. Supported: exact (`=x.y.z` or bare
 * `x.y.z(-pre)`), caret, tilde, and `>` / `<` floors. A constraint with a
 * prerelease segment is satisfied by versions that order `>=` the constraint's
 * own prerelease (no identifier padding); a constraint without one is never
 * satisfied by a prerelease version. Unparseable constraint forms are
 * permissive (`true`) — remote manifests may carry shapes this module does not
 * model, and an unverifiable gate must not block.
 */
export function satisfiesConstraint(version: string, constraint: string): boolean {
  const trimmed = constraint.trim();
  if (!trimmed) return true;
  const match = /^(\^|~|<|>|=)?\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(trimmed);
  if (!match) return true;
  const operator = match[1] ?? "";
  const floor = `${match[2]}.${match[3]}.${match[4]}${match[5] ? `-${match[5]}` : ""}`;
  const comparison = compareSemver(version, floor);
  if (!operator || operator === "=") return comparison === 0;
  if (operator === "<") return comparison < 0;
  if (operator === ">") return comparison > 0;
  const subject = parseVersion(version);
  if (!subject) return false;
  if (!match[5] && subject.prerelease.length > 0) return false;
  if (match[5] && subject.prerelease.length === 0) return false;
  if (comparison < 0) return false;
  if (operator === "~") {
    return subject.core[0] === Number(match[2]) && subject.core[1] === Number(match[3]);
  }
  return subject.core[0] === Number(match[2]);
}
