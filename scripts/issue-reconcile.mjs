#!/usr/bin/env node
// Issue reconciliation sweep (#957 part 2) — keeps the tracker honest between
// human triage sessions. Zero-dependency (node builtins + fetch), no clone of
// anything, batched GraphQL against the GitHub API.
//
//   report (default)  node scripts/issue-reconcile.mjs --since <ISO> [--out report.json] [--triage-days 7]
//   apply             node scripts/issue-reconcile.mjs --apply report.json [--tracking-issue N] [--auto-close]
//
// Report mode is read-only: it prints the sweep to $GITHUB_STEP_SUMMARY and
// writes the machine report to --out. Apply mode performs writes, but only the
// ones explicitly enabled: --auto-close closes fixed-but-open issues with the
// credit-comment pattern the manual sweeps used (#478/#473/#739/#920), and
// --tracking-issue posts the full report as a comment on one tracking issue.
import { readFileSync, writeFileSync } from "node:fs";

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");

const FIX_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
const BLOCKER_LINE_RE = /^\s*(?:[-*]\s*)?blocked\s+by\s*:/i;

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const outPath = flag("--out");
const applyPath = flag("--apply");
const trackingIssue = flag("--tracking-issue");
const autoClose = args.includes("--auto-close");
const triageDays = Number(flag("--triage-days") ?? 7);
const since = flag("--since");

if (!token || !owner) {
  console.error("GH_TOKEN (or GITHUB_TOKEN) and GITHUB_REPOSITORY are required");
  process.exit(1);
}

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "issue-reconcile",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!json.data) {
    throw new Error(`graphql failed: ${JSON.stringify(json.errors ?? json).slice(0, 500)}`);
  }
  return json.data;
}

async function rest(method, path, payload) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "issue-reconcile",
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

async function sweep(sinceIso, triageDays_) {
  const PAGE = `
    query($owner: String!, $repo: String!, $q: String!, $afterPrs: String, $afterIssues: String) {
      prs: search(first: 100, type: ISSUE, query: $q, after: $afterPrs) {
        issueCount
        pageInfo { hasNextPage endCursor }
        nodes { ... on PullRequest { number title url mergedAt body } }
      }
      repository(owner: $owner, name: $repo) {
        issues: issues(first: 100, states: OPEN, orderBy: {field: CREATED_AT, direction: ASC}, after: $afterIssues) {
          pageInfo { hasNextPage endCursor }
          nodes { number title url createdAt updatedAt body labels(first: 10) { nodes { name } } }
        }
      }
    }`;
  const q = `repo:${owner}/${repo} is:pr is:merged merged:>=${sinceIso}`;
  const merged = [];
  const openIssues = [];
  let afterPrs;
  let afterIssues;
  for (;;) {
    const d = await graphql(PAGE, { owner, repo, q, afterPrs, afterIssues });
    merged.push(...d.prs.nodes);
    openIssues.push(...d.repository.issues.nodes);
    if (!d.prs.pageInfo.hasNextPage && !d.repository.issues.pageInfo.hasNextPage) break;
    if (d.prs.pageInfo.hasNextPage) afterPrs = d.prs.pageInfo.endCursor;
    if (d.repository.issues.pageInfo.hasNextPage)
      afterIssues = d.repository.issues.pageInfo.endCursor;
  }

  const openNumbers = new Set(openIssues.map((i) => i.number));
  const fixedBy = new Map();
  for (const pr of merged) {
    const refs = new Set([...(pr.body ?? "").matchAll(FIX_RE)].map((m) => Number(m[1])));
    for (const n of refs) {
      if (!fixedBy.has(n)) fixedBy.set(n, []);
      fixedBy.get(n).push({ pr: pr.number, url: pr.url, title: pr.title, mergedAt: pr.mergedAt });
    }
  }
  const fixedOpen = [...fixedBy.entries()]
    .filter(([n]) => openNumbers.has(n))
    .map(([n, by]) => ({ issue: n, fixedBy: by }));

  const blockerRefs = new Map();
  for (const issue of openIssues) {
    const nums = new Set();
    for (const line of (issue.body ?? "").split("\n")) {
      if (BLOCKER_LINE_RE.test(line)) {
        for (const m of line.matchAll(/#(\d+)/g)) nums.add(Number(m[1]));
      }
    }
    if (nums.size) blockerRefs.set(issue.number, [...nums]);
  }
  const referenced = new Set(fixedBy.keys());
  for (const nums of blockerRefs.values()) for (const n of nums) referenced.add(n);
  const states = new Map();
  const missing = [];
  const numbers = [...referenced].filter((n) => !openNumbers.has(n));
  for (let i = 0; i < numbers.length; i += 90) {
    const chunk = numbers.slice(i, i + 90);
    const fields = chunk
      .map((n, j) => `i${j}: issue(number: ${n}) { number state closedAt }`)
      .join("\n");
    const d = await graphql(
      `query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { ${fields} } }`,
      { owner, repo },
    );
    for (const [j, n] of chunk.entries()) {
      const node = d.repository[`i${j}`];
      if (node) states.set(n, node);
      else missing.push(n);
    }
  }
  const staleBlockers = [];
  for (const [issue, nums] of blockerRefs) {
    for (const n of nums) {
      const node = states.get(n);
      if (node?.state === "CLOSED") {
        staleBlockers.push({ issue, blocker: n, closedAt: node.closedAt });
      }
    }
  }

  const cutoff = Date.now() - triageDays_ * 24 * 3600 * 1000;
  const staleTriage = openIssues
    .filter(
      (i) =>
        i.labels.nodes.some((l) => l.name === "needs-triage") &&
        new Date(i.createdAt).getTime() < cutoff,
    )
    .map((i) => ({ issue: i.number, createdAt: i.createdAt }));

  return {
    since: sinceIso,
    triageDays: triageDays_,
    scannedAt: new Date().toISOString(),
    mergedCount: merged.length,
    openIssueCount: openIssues.length,
    fixedOpen,
    staleBlockers,
    staleTriage,
    unresolvableBlockers: missing,
  };
}

function renderSummary(report) {
  const fmt = (iso) => (iso ? iso.slice(0, 10) : "unknown");
  const rows = [];
  rows.push(`## Issue reconciliation sweep`);
  rows.push("");
  rows.push(
    `Window: merged PRs since \`${fmt(report.since)}\` · ${report.mergedCount} merged PRs, ${report.openIssueCount} open issues scanned (\`${fmt(report.scannedAt)}\`).`,
  );
  rows.push("");
  rows.push(`### Fixed-but-open issues`);
  rows.push("");
  if (report.fixedOpen.length === 0) {
    rows.push("None — clean.");
  } else {
    rows.push("| Issue | Fixed by | Merged |");
    rows.push("| ----- | -------- | ------ |");
    for (const f of report.fixedOpen) {
      const by = f.fixedBy.map((p) => `#${p.pr}`).join(", ");
      const mergedAt = f.fixedBy.map((p) => fmt(p.mergedAt)).join(", ");
      rows.push(`| #${f.issue} | ${by} | ${mergedAt} |`);
    }
  }
  rows.push("");
  rows.push(`### Stale blocker links`);
  rows.push("");
  if (report.staleBlockers.length === 0) {
    rows.push("None — clean.");
  } else {
    rows.push("| Issue | Closed blocker | Closed on |");
    rows.push("| ----- | -------------- | --------- |");
    for (const s of report.staleBlockers) {
      rows.push(`| #${s.issue} | #${s.blocker} | ${fmt(s.closedAt)} |`);
    }
  }
  if (report.unresolvableBlockers.length) {
    rows.push("");
    rows.push(
      `Unresolvable blocker references (deleted or not an issue): ${report.unresolvableBlockers.map((n) => `#${n}`).join(", ")}.`,
    );
  }
  rows.push("");
  rows.push(`### \`needs-triage\` older than ${report.triageDays} days`);
  rows.push("");
  if (report.staleTriage.length === 0) {
    rows.push("None — clean.");
  } else {
    rows.push("| Issue | Opened |");
    rows.push("| ----- | ------ |");
    for (const t of report.staleTriage) rows.push(`| #${t.issue} | ${fmt(t.createdAt)} |`);
  }
  rows.push("");
  rows.push(
    "Read-only sweep — nothing was closed or commented. Enable via workflow inputs (`auto-close`, `tracking-issue`). See docs/agents/issue-tracker.md.",
  );
  rows.push("");
  return rows.join("\n");
}

async function apply(report) {
  let wrote = 0;
  if (trackingIssue) {
    await rest("POST", `issues/${trackingIssue}/comments`, {
      body: `Issue reconciliation sweep (${report.scannedAt.slice(0, 10)}) — merged PRs since \`${report.since.slice(0, 10)}\`:\n\n${renderSummary(report)}`,
    });
    wrote += 1;
    console.log(`posted the report on #${trackingIssue}`);
  }
  if (autoClose) {
    for (const f of report.fixedOpen) {
      const current = await rest("GET", `issues/${f.issue}`);
      if (current.state !== "open") {
        console.log(`#${f.issue} already closed — skipping`);
        continue;
      }
      const credit = f.fixedBy
        .map((p) => `#${p.pr} (${p.title}, merged ${p.mergedAt.slice(0, 10)})`)
        .join("; ");
      await rest("POST", `issues/${f.issue}/comments`, {
        body: `Closing as already fixed: ${credit}. Spotted by the issue reconciliation sweep — see docs/agents/issue-tracker.md.`,
      });
      await rest("PATCH", `issues/${f.issue}`, { state: "closed", state_reason: "completed" });
      wrote += 1;
      console.log(`closed #${f.issue} with credit to ${credit}`);
    }
  }
  return wrote;
}

if (applyPath) {
  const report = JSON.parse(readFileSync(applyPath, "utf8"));
  if (!trackingIssue && !autoClose) {
    console.error("apply mode needs --tracking-issue and/or --auto-close");
    process.exit(1);
  }
  const wrote = await apply(report);
  console.log(`apply complete: ${wrote} write(s)`);
} else {
  if (!since) {
    console.error("report mode needs --since <ISO>");
    process.exit(1);
  }
  const report = await sweep(since, triageDays);
  const summary = renderSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: "a" });
  }
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(summary);
  console.log(
    `sweep complete: ${report.fixedOpen.length} fixed-but-open, ${report.staleBlockers.length} stale blockers, ${report.staleTriage.length} stale needs-triage`,
  );
}
