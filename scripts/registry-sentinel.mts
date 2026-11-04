/**
 * The registry sentinel (registry-primitive ticket 12): a cold-cache
 * registry-resolution check that runs independent of deploys and PRs — the
 * detector for registry-side drift (wrong gateway, missing manifest legs,
 * stale index). Nightly in `.github/workflows/backcompat-nightly.yml`.
 *
 * Checks, against the production root (overridable via SENTINEL_ACCOUNT /
 * SENTINEL_GATEWAY):
 *   1. the manifest tag serves and parses;
 *   2. the tag's version record serves and is byte-identical content
 *      (the train's atomic write carries both — a divergence is drift);
 *   3. the resolution machine resolves Latest AND Pinned with the cache
 *      force-missed (exactly what a fresh child does);
 *   4. no dead-end ancestor: every extends ancestor serves manifest legs,
 *      or its last registry write is inside the staleness budget — the
 *      gateway-incident shape (`dev.everything.dev`) reds here.
 * Every check prints its evidence (chain, block heights, dates, digests);
 * any failure exits 1.
 */
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Manifest,
  ManifestSchema,
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
const TAG_KEY = `apps/${ACCOUNT}/${GATEWAY}/platform.json`;
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
const sha256 = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const ageDays = (blockTimestampNs: string): number =>
  (Date.now() - Number(blockTimestampNs) / 1_000_000) / 86_400_000;

// 1 + 2 — the tag home and its immutable version record
const tag = await fetchRegistryKeyOrNull<unknown>(ACCOUNT, GATEWAY, "platform.json");
check(
  tag !== null,
  `the manifest tag does not serve at ${TAG_KEY} — the release leg never published (or was wiped)`,
);
let manifest: Manifest | undefined;
if (tag) {
  try {
    manifest = ManifestSchema.parse(tag);
    evidence("tag frameworkVersion", manifest.frameworkVersion);
    evidence("tag gitSha", manifest.gitSha ?? "none");
  } catch (error) {
    check(
      false,
      `the manifest tag does not parse: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (manifest) {
  const record = await fetchRegistryKey<unknown>(
    ACCOUNT,
    GATEWAY,
    `platform-versions/${manifest.frameworkVersion}.json`,
  );
  check(
    record !== null,
    `the version record for ${manifest.frameworkVersion} does not serve — the release deploy is incomplete`,
  );
  if (record) {
    const identical = JSON.stringify(tag) === JSON.stringify(record);
    check(
      identical,
      `the tag and the version record diverge — tag sha ${sha256(tag)}, record sha ${sha256(record)}`,
    );
    evidence("tag/record digest", `${sha256(tag)} (both, when identical)`);
  }
}

// 3 — the machine, cold: Latest + Pinned with the cache force-missed
const cacheDir = mkdtempSync(join(tmpdir(), "registry-sentinel-"));
const neverCached = { state: "miss" as const };
const localConfig = { extends: REF };
for (const query of [
  { kind: "Latest" },
  { kind: "Pinned", release: manifest?.frameworkVersion ?? "unknown" },
] as const) {
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
  const leg = await fetchRegistryKeyOrNull<unknown>(node.account, node.gateway, "platform.json");
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
