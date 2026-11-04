/**
 * The registry sentinel (registry-primitive ticket 12, wire updated to the
 * ADR 0040 cutover by the boot-snapshot sprint's ticket 04): a cold-cache
 * registry-resolution check that runs independent of deploys and PRs — the
 * detector for registry-side drift (wrong gateway, missing manifest legs,
 * stale index). Nightly in `.github/workflows/backcompat-nightly.yml`.
 *
 * Checks, against the production root (overridable via SENTINEL_ACCOUNT /
 * SENTINEL_GATEWAY):
 *   1. the thin tag serves at `manifest.json` and parses
 *      (`{ schemaVersion, version, digest }`);
 *   2. the named immutable version record serves at `versions/<v>.json` and
 *      its serialized bytes hash to the tag's digest (the digest chain);
 *   3. the resolution machine resolves Latest AND Pinned with the cache
 *      force-missed (exactly what a fresh child does);
 *   4. no dead-end ancestor: every extends ancestor serves a thin tag,
 *      or its last registry write is inside the staleness budget — the
 *      gateway-incident shape (`dev.everything.dev`) reds here.
 * Every check prints its evidence (chain, block heights, dates, digests);
 * any failure exits 1.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  digestOfManifest,
  type Manifest,
  ManifestSchema,
  ManifestTagSchema,
} from "../packages/everything-dev/src/services/platform/manifest-schema";
import {
  fetchConfigHistory,
  fetchRegistryKey,
  fetchRegistryKeyOrNull,
} from "../packages/everything-dev/src/services/registry/fastkv";
import { resolveRelease } from "../packages/everything-dev/src/services/registry/resolution";
import { fetchParentConfig } from "../packages/everything-dev/src/services/resolution/init-source";
import {
  DEFAULT_PARENT_ACCOUNT,
  DEFAULT_PARENT_GATEWAY,
} from "../packages/everything-dev/src/services/scaffold/init-flow";

const ACCOUNT = process.env.SENTINEL_ACCOUNT ?? DEFAULT_PARENT_ACCOUNT;
const GATEWAY = process.env.SENTINEL_GATEWAY ?? DEFAULT_PARENT_GATEWAY;
const REF = `bos://${ACCOUNT}/${GATEWAY}`;
const TAG_REL_KEY = "manifest.json";
const TAG_KEY = `apps/${ACCOUNT}/${GATEWAY}/${TAG_REL_KEY}`;
const STALENESS_BUDGET_DAYS = Number(process.env.SENTINEL_STALENESS_DAYS ?? 30);

const failures: string[] = [];
const evidence = (label: string, detail: unknown): void => {
  console.log(
    `  [sentinel] ${label}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
  );
};
const check = (ok: boolean, failMessage: string): void => {
  if (!ok) failures.push(failMessage);
};
const ageDays = (blockTimestampNs: string): number =>
  (Date.now() - Number(blockTimestampNs) / 1_000_000) / 86_400_000;

// 1 — the thin tag at its cutover home
const tag = await fetchRegistryKeyOrNull<unknown>(ACCOUNT, GATEWAY, TAG_REL_KEY);
check(
  tag !== null,
  `the thin tag does not serve at ${TAG_KEY} — the release leg never published (or was wiped)`,
);
let manifest: Manifest | undefined;
let tagVersion: string | undefined;
if (tag) {
  const decoded = ManifestTagSchema.safeParse(tag);
  if (!decoded.success) {
    check(
      false,
      `the tag does not decode as the thin shape ({ schemaVersion, version, digest }): ${decoded.error.message}`,
    );
  } else {
    tagVersion = decoded.data.version;
    evidence("tag version", decoded.data.version);
    evidence("tag digest", decoded.data.digest);
  }
}

// 2 — the immutable version record the tag names, verified by the digest chain
if (tagVersion) {
  const record = await fetchRegistryKey<unknown>(ACCOUNT, GATEWAY, `versions/${tagVersion}.json`);
  check(
    record !== null,
    `the version record for ${tagVersion} does not serve at versions/${tagVersion}.json — the release deploy is incomplete`,
  );
  if (record) {
    manifest = ManifestSchema.safeParse(record).success ? ManifestSchema.parse(record) : undefined;
    if (!manifest) {
      check(false, `the version record does not parse as a release manifest`);
    }
    // JSON preserves key order, so the re-serialized record's bytes are the
    // published bytes — the same assumption the resolution machine's digest
    // verification makes (ADR 0040).
    const recordDigest = digestOfManifest(JSON.stringify(record));
    const tagDigest =
      tag && typeof tag === "object" && "digest" in tag
        ? (tag as { digest: string }).digest
        : undefined;
    check(
      recordDigest === tagDigest,
      `the digest chain is broken — tag names ${tagDigest}, the record hashes to ${recordDigest}`,
    );
    evidence("tag → record digest", recordDigest);
    evidence("record frameworkVersion", manifest?.frameworkVersion ?? "unparsed");
  }
}
const pinnedRelease = manifest?.frameworkVersion ?? tagVersion ?? "unknown";

// 3 — the machine, cold: Latest + Pinned with the cache force-missed
const cacheDir = mkdtempSync(join(tmpdir(), "registry-sentinel-"));
const neverCached = { state: "miss" as const };
const localConfig = { extends: REF };
for (const query of [{ kind: "Latest" }, { kind: "Pinned", release: pinnedRelease }] as const) {
  const outcome = await resolveRelease({
    query: query as never,
    localConfig,
    configDir: cacheDir,
    seams: { cacheRead: () => neverCached },
  });
  check(
    outcome.state === "Resolved",
    `cold ${query.kind} resolution did not resolve: ${outcome.state === "Unresolved" ? `${outcome.reason}${outcome.detail ? ` — ${outcome.detail}` : ""}` : "unexpected"}`,
  );
  if (outcome.state === "Resolved") {
    evidence(`cold ${query.kind}`, `${outcome.manifest.frameworkVersion} from ${outcome.from}`);
  }
}

// 4 — dead-end ancestors: the gateway-incident detector
const ancestors: Array<{ account: string; gateway: string }> = [
  { account: ACCOUNT, gateway: GATEWAY },
];
let cursor: { account: string; gateway: string } | undefined = ancestors[0];
for (let hop = 0; hop < 5 && cursor; hop++) {
  const parentConfig = await fetchParentConfig(cursor.account, cursor.gateway).catch(() => null);
  const extendsRef =
    parentConfig && typeof (parentConfig as Record<string, unknown>).extends === "string"
      ? ((parentConfig as Record<string, unknown>).extends as string)
      : undefined;
  const next = extendsRef?.match(/^bos:\/\/([^/]+)\/(.+)$/);
  if (!next) break;
  cursor = { account: next[1]!, gateway: next[2]! };
  if (ancestors.some((a) => a.account === cursor!.account && a.gateway === cursor!.gateway)) break;
  ancestors.push(cursor);
}
evidence("extends chain", ancestors.map((a) => `bos://${a.account}/${a.gateway}`).join(" → "));

for (const node of ancestors) {
  const leg = await fetchRegistryKeyOrNull<unknown>(node.account, node.gateway, "manifest.json");
  if (leg) continue;
  const history = await fetchConfigHistory({
    accountId: node.account,
    gatewayId: node.gateway,
    keyPath: `apps/${node.account}/${node.gateway}/bos.config.json`,
    limit: 1,
  }).catch(() => []);
  const lastWriteNs = history[0]?.blockTimestampNs;
  const lastWriteDays = lastWriteNs ? ageDays(lastWriteNs) : Number.POSITIVE_INFINITY;
  const lastWriteIso = lastWriteNs
    ? new Date(Number(lastWriteNs) / 1_000_000).toISOString()
    : "never";
  evidence(
    `dead-end probe ${`bos://${node.account}/${node.gateway}`}`,
    `manifest leg: absent; last config write: ${lastWriteIso} (block ${history[0]?.blockHeight ?? "?"})`,
  );
  check(
    lastWriteDays <= STALENESS_BUDGET_DAYS,
    `the extends chain terminates at ${`bos://${node.account}/${node.gateway}`} — no manifest legs and the last write ` +
      `${lastWriteIso} is outside the ${STALENESS_BUDGET_DAYS}-day staleness budget (the gateway-incident shape)`,
  );
}

const tagHistory = await fetchConfigHistory({
  accountId: ACCOUNT,
  gatewayId: GATEWAY,
  keyPath: TAG_KEY,
  limit: 1,
}).catch(() => []);
evidence(
  "tag block",
  tagHistory[0]
    ? `height ${tagHistory[0].blockHeight}, ${new Date(Number(tagHistory[0].blockTimestampNs) / 1_000_000).toISOString()}`
    : "no history",
);

if (failures.length > 0) {
  console.error(`\n[registry-sentinel] RED — ${failures.length} check(s) failed against ${REF}:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`\n[registry-sentinel] GREEN — ${REF} serves a coherent release composition.`);
