import { Effect } from "effect";
import { detectRouterSeam } from "../checks/ui-seam";
import { fileExists, readText, writeText } from "../fs";
import type { StepResult } from "./author-config";

const ROUTER_PATH = "ui/src/router.tsx";

const CREATE_QUERY_CLIENT_RE =
  /export\s+function\s+createQueryClient\s*\(\s*\)\s*:\s*QueryClient\s*\{/;

const DEFAULT_COMPONENT_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ["defaultErrorComponent", "Oops!"],
  ["defaultNotFoundComponent", "Not Found"],
  ["defaultPendingComponent", "Loading..."],
];

const extractBlock = (source: string, openIdx: number): string | null => {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  return null;
};

export const extractCreateQueryClient = (source: string): string | null => {
  const match = source.match(CREATE_QUERY_CLIENT_RE);
  if (!match || match.index === undefined) return null;
  const openIdx = source.indexOf("{", match.index + match[0].length - 1);
  if (openIdx === -1) return null;
  const block = extractBlock(source, openIdx);
  if (!block) return null;
  return source.slice(match.index, openIdx + block.length).trimEnd();
};

const customComponentNotes = (source: string): string[] => {
  const notes: string[] = [];
  for (const [name, marker] of DEFAULT_COMPONENT_MARKERS) {
    const defined = new RegExp(`function\\s+${name}\\s*\\(`).test(source);
    if (defined && !source.includes(marker)) {
      notes.push(
        `custom ${name} detected — the core router hardcodes its defaults until router-client spreads opts; re-apply it after the spread on a framework version that supports it`,
      );
    }
  }
  return notes;
};

const renderAuthoredRouter = (queryClientFn: string | null): string =>
  [
    "/**",
    " * Client router — the app's authored router factory, the single customization",
    " * seam for router policy (notFound/pending/error components, scroll behavior,",
    " * query timings via the `createQueryClient` export). Minted through the",
    " * framework's client factory; the composed manifest tree arrives at call",
    " * time and wins over the bundled core-only tree.",
    " *",
    " * This file is yours — scaffolded once, never overwritten by `bos sync`",
    " * (ADR 0023). Edit the policy defaults after the `...opts` spread freely.",
    " */",
    "",
    ...(queryClientFn ? ['import { QueryClient } from "@tanstack/react-query";'] : []),
    'import { createRouter as createCoreRouter } from "everything-dev/ui/router-client";',
    'import type { ApiClient, CreateRouterOptions, SessionData } from "./app";',
    'import { routeTree } from "./routeTree.gen";',
    "",
    "export type {",
    "  ClientRuntimeConfig,",
    "  CreateRouterOptions,",
    "  RouterContext,",
    "  RouterModule,",
    '} from "./app";',
    "",
    "export function createRouter(opts: CreateRouterOptions) {",
    "  return createCoreRouter<ApiClient, SessionData, typeof routeTree>({",
    "    ...opts,",
    "    defaultRouteTree: routeTree,",
    "  });",
    "}",
    ...(queryClientFn ? ["", queryClientFn] : []),
    "",
    "export { routeTree };",
    "",
    'declare module "@tanstack/react-router" {',
    "  interface Register {",
    '    router: ReturnType<typeof createRouter>["router"];',
    "  }",
    "}",
    "",
  ].join("\n");

export const migrateUiSeam = (
  projectDir: string,
  dryRun: boolean,
): Effect.Effect<StepResult, Error> =>
  Effect.gen(function* () {
    const exists = yield* fileExists(projectDir, ROUTER_PATH);
    if (!exists) {
      return {
        writes: [],
        deletes: [],
        notes: ["ui/src/router.tsx absent — nothing to migrate"],
      };
    }

    const source = yield* readText(projectDir, ROUTER_PATH);
    const seam = detectRouterSeam(source);
    if (seam === "authored-seam") {
      return { writes: [], deletes: [], notes: ["router.tsx already on the authored seam"] };
    }
    if (seam === "unknown") {
      return {
        writes: [],
        deletes: [],
        notes: [
          "router.tsx is not the known monolithic factory — left untouched, inspect manually",
        ],
      };
    }

    const queryClientFn = extractCreateQueryClient(source);
    const next = renderAuthoredRouter(queryClientFn);
    if (!dryRun) {
      yield* writeText(projectDir, ROUTER_PATH, next);
    }
    return {
      writes: [ROUTER_PATH],
      deletes: [],
      notes: [
        "router factory migrated to the createCoreRouter authored seam (ADR 0023) — the composed manifest tree now wins over the bundled core-only tree",
        ...(queryClientFn
          ? []
          : [
              "no createQueryClient found in the old factory — the core default query timings apply",
            ]),
        ...customComponentNotes(source),
      ],
    };
  });
