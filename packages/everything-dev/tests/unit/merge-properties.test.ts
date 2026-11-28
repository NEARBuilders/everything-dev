import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BOS_CONFIG_ORDER,
  mergeAuthoredOverPublished,
  mergeBosConfigWithExtends,
  rebuildOrderedConfig,
  resolveExtendsRef,
  stripLocalDevelopmentTargets,
  stripSeedConfig,
} from "../../src/services/resolution/merge";
import type { BosConfigInput } from "../../src/types";

// CI-run property tests pin a recorded seed (#959): a random seed per CI run
// flakes clean main whenever the seed draws a conflict case (#948 presented
// exactly that way). This seed passed a local run of every law below at the
// pinned run counts. Exploratory random-seed runs are a deliberate local
// action, never the CI default; a counterexample any seed uncovers becomes a
// pinned deterministic regression test in this file. Convention:
// docs/agents/testing.md ("Test value rules").
const PROPERTY_SEED = 20261127;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const KEY_ALPHA = [
  "account",
  "domain",
  "title",
  "repository",
  "app",
  "plugins",
  "release",
  "publish",
  "extra",
];

const NESTED_KEY_ALPHA = [
  "api",
  "ui",
  "host",
  "auth",
  "shared",
  "effect",
  "zod",
  "variables",
  "development",
  "production",
  "secrets",
  "connectSrc",
  "alpha",
  "beta",
];

const WORD = fc.stringMatching(/^[a-zA-Z]{1,6}$/);

const digestObject = fc
  .record({ integrity: WORD, url: WORD, pin: fc.boolean() })
  .map((r) => r as Json);

const jsonValue: fc.Arbitrary<Json> = fc.letrec((tie) => {
  const scalar: fc.Arbitrary<Json> = fc.oneof(
    WORD,
    fc.boolean(),
    fc.integer({ min: -1000, max: 1000 }),
    fc.constant(null),
  );
  const list: fc.Arbitrary<Json> = fc.array(WORD, { maxLength: 4 }).map((xs) => xs as Json);
  const obj = fc.dictionary(
    fc.constantFrom(...NESTED_KEY_ALPHA),
    fc.oneof(
      { arbitrary: scalar, weight: 4 },
      { arbitrary: list, weight: 2 },
      { arbitrary: tie("obj") as unknown as fc.Arbitrary<Json>, weight: 3 },
      { arbitrary: digestObject, weight: 1 },
    ),
    { minKeys: 0, maxKeys: 4 },
  );
  return { obj };
}).obj;

const arbitraryConfig: fc.Arbitrary<Record<string, Json>> = fc.dictionary(
  fc.constantFrom(...KEY_ALPHA),
  jsonValue,
  { minKeys: 0, maxKeys: 5 },
);

const scalarNoNull: fc.Arbitrary<Json> = fc.oneof(
  WORD,
  fc.boolean(),
  fc.integer({ min: -1000, max: 1000 }),
);

const nullFreeValue: fc.Arbitrary<Json> = fc.letrec((tie) => {
  const scalar: fc.Arbitrary<Json> = scalarNoNull;
  const list: fc.Arbitrary<Json> = fc.array(WORD, { maxLength: 4 }).map((xs) => xs as Json);
  const obj = fc.dictionary(
    fc.constantFrom(...NESTED_KEY_ALPHA),
    fc.oneof(
      { arbitrary: scalar, weight: 5 },
      { arbitrary: list, weight: 2 },
      { arbitrary: tie("obj") as unknown as fc.Arbitrary<Json>, weight: 3 },
    ),
    { minKeys: 0, maxKeys: 4 },
  );
  return { obj };
}).obj;

const nullFreeConfig: fc.Arbitrary<Record<string, Json>> = fc.dictionary(
  fc.constantFrom(...KEY_ALPHA),
  nullFreeValue,
  { minKeys: 0, maxKeys: 5 },
);

function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canon(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function mergeExtends(parent: Record<string, Json>, child: Record<string, Json>): Json {
  return mergeBosConfigWithExtends(
    parent as unknown as BosConfigInput,
    child as unknown as BosConfigInput,
  ) as unknown as Json;
}

function overlayAuthored(published: Record<string, Json>, authored: Record<string, Json>): Json {
  return mergeAuthoredOverPublished(
    published as unknown as BosConfigInput,
    authored as unknown as BosConfigInput,
  ) as unknown as Json;
}

function getPath(value: Json, path: string[]): Json {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`path ${path.join(".")} missing at ${key}`);
    }
    current = (current as Record<string, Json>)[key];
  }
  return current;
}

function setPath(value: Record<string, Json>, path: string[], leaf: Json): Record<string, Json> {
  if (path.length === 0) throw new Error("path must have at least one key");
  const [head, ...rest] = path;
  const out: Record<string, Json> = { ...value };
  if (rest.length === 0) {
    out[head] = leaf;
    return out;
  }
  const nested = out[head];
  const base =
    nested !== null && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, Json>)
      : {};
  out[head] = setPath(base, rest, leaf);
  return out;
}

type ShapeKind = "object" | "array" | "scalar";

function shapeKind(value: Json): ShapeKind {
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return "scalar";
}

function typeCompatible(a: Json, b: Json): boolean {
  if (shapeKind(a) !== shapeKind(b)) return false;
  if (shapeKind(a) !== "object") return true;
  const ra = a as Record<string, Json>;
  const rb = b as Record<string, Json>;
  for (const key of Object.keys(ra)) {
    if (key in rb && !typeCompatible(ra[key], rb[key])) return false;
  }
  for (const key of Object.keys(rb)) {
    if (key in ra && !typeCompatible(ra[key], rb[key])) return false;
  }
  return true;
}

const mergePathAlpha = ["app", "api", "shared", "effect", "variables", "alpha"];
const mergePath = fc.array(fc.constantFrom(...mergePathAlpha), { minLength: 1, maxLength: 3 });

function dedupParentFirst(parent: Json[], child: Json[]): Json[] {
  return [...new Set([...parent, ...child])];
}

function cleanSentinels(value: Json): Json {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, Json> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "object" && !Array.isArray(val)) {
      const cleaned = cleanSentinels(val);
      if (Object.keys(cleaned as object).length > 0) out[key] = cleaned;
    } else if (Array.isArray(val) && (key === "secrets" || key === "connectSrc")) {
      out[key] = [...new Set(val as Json[])] as Json;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function cleanPluginsSection(plugins: Json): Json {
  const cleaned = cleanSentinels(plugins);
  if (cleaned === null || typeof cleaned !== "object" || Array.isArray(cleaned)) return cleaned;
  const out: Record<string, Json> = {};
  for (const [id, entry] of Object.entries(cleaned)) {
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      const entryOut: Record<string, Json> = { ...entry };
      for (const unionKey of ["secrets", "connectSrc"]) {
        const arr = entryOut[unionKey];
        if (Array.isArray(arr)) entryOut[unionKey] = [...new Set(arr)] as Json;
      }
      out[id] = entryOut;
    } else {
      out[id] = entry;
    }
  }
  return out;
}

const resolvedConfig: fc.Arbitrary<Record<string, Json>> = nullFreeConfig.filter((config) => {
  const plugins = config.plugins;
  if (plugins === undefined || plugins === null) return true;
  if (typeof plugins !== "object" || Array.isArray(plugins)) return true;
  return canon(cleanPluginsSection(plugins)) === canon(plugins);
});

describe("mergeBosConfigWithExtends laws", () => {
  it("associativity on the null-free domain: chain resolution is grouping-independent", () => {
    // Type-conflicting triples are exempt (#948): a same-path conflict where
    // exactly one side is a plain object resolves by wholesale replacement of
    // the non-object side (child-wins), so across three overlays the
    // replacement order decides which shape survives and the law stops holding
    // — same documented asymmetry class as the null case below and the
    // mergeAuthoredOverPublished exemption further down. Nulls stay in the law.
    const prop = fc
      .tuple(nullFreeConfig, nullFreeConfig, nullFreeConfig)
      .filter(([a, b, c]) => typeCompatible(a, b) && typeCompatible(b, c) && typeCompatible(a, c))
      .map(([a, b, c]) => ({ a, b, c }));
    const law = fc.property(prop, ({ a, b, c }) => {
      const left = mergeExtends(a, mergeExtends(b, c));
      const right = mergeExtends(mergeExtends(a, b), c);
      return canon(left) === canon(right);
    });
    expect(fc.assert(law, { numRuns: 300, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("associativity with nulls fails by design: parent null absorbs, child null is transparent (documented)", () => {
    const left = mergeExtends(
      { publish: {} },
      mergeExtends({ publish: { zod: null } }, { publish: { zod: false } }),
    );
    const right = mergeExtends(mergeExtends({ publish: {} }, { publish: { zod: null } }), {
      publish: { zod: false },
    });
    expect(canon(left)).not.toBe(canon(right));
  });

  it("associativity with shape conflicts fails by design: child non-object wins, grouping decides which shape survives (documented, #948)", () => {
    const scalarFirst = {
      a: { title: { ui: { api: {} } } } as Record<string, Json>,
      b: { title: { ui: 0 } } as Record<string, Json>,
      c: { title: { ui: {} } } as Record<string, Json>,
    };
    const arrayFirst = {
      a: { title: { connectSrc: { api: [] } } } as Record<string, Json>,
      b: { title: { connectSrc: [] } } as Record<string, Json>,
      c: { title: { connectSrc: {} } } as Record<string, Json>,
    };

    expect(canon(mergeExtends(scalarFirst.a, scalarFirst.b))).toBe(canon({ title: { ui: 0 } }));
    expect(canon(mergeExtends(mergeExtends(scalarFirst.a, scalarFirst.b), scalarFirst.c))).toBe(
      canon({ title: { ui: {} } }),
    );
    expect(canon(mergeExtends(scalarFirst.a, mergeExtends(scalarFirst.b, scalarFirst.c)))).toBe(
      canon({ title: { ui: { api: {} } } }),
    );

    expect(canon(mergeExtends(arrayFirst.a, arrayFirst.b))).toBe(
      canon({ title: { connectSrc: [] } }),
    );
    expect(canon(mergeExtends(mergeExtends(arrayFirst.a, arrayFirst.b), arrayFirst.c))).toBe(
      canon({ title: { connectSrc: {} } }),
    );
    expect(canon(mergeExtends(arrayFirst.a, mergeExtends(arrayFirst.b, arrayFirst.c)))).toBe(
      canon({ title: { connectSrc: { api: [] } } }),
    );
  });

  it("child scalar precedence at arbitrary paths", () => {
    const prop = fc.property(
      arbitraryConfig,
      arbitraryConfig,
      mergePath,
      scalarNoNull,
      scalarNoNull,
      (a, b, path, parentLeaf, childLeaf) => {
        const parent = setPath(a, path, parentLeaf);
        const child = setPath(b, path, childLeaf);
        return getPath(mergeExtends(parent, child), path) === childLeaf;
      },
    );
    expect(fc.assert(prop, { numRuns: 300, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("parent null wins: a null in the parent shadows any child value", () => {
    const prop = fc.property(
      arbitraryConfig,
      arbitraryConfig,
      mergePath,
      scalarNoNull,
      (a, b, path, childLeaf) => {
        const parent = setPath(a, path, null);
        const child = setPath(b, path, childLeaf);
        return getPath(mergeExtends(parent, child), path) === null;
      },
    );
    expect(fc.assert(prop, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("child null is transparent: the parent value stands", () => {
    const prop = fc.property(
      arbitraryConfig,
      arbitraryConfig,
      mergePath,
      scalarNoNull,
      (a, b, path, parentLeaf) => {
        const parent = setPath(a, path, parentLeaf);
        const child = setPath(b, path, null);
        return getPath(mergeExtends(parent, child), path) === parentLeaf;
      },
    );
    expect(fc.assert(prop, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("child null over a key the parent lacks stays absent", () => {
    const prop = fc.property(fc.record({ account: WORD, domain: WORD }), (parent) => {
      const merged = mergeExtends(parent, { app: null });
      return canon(merged) === canon(parent);
    });
    expect(fc.assert(prop, { numRuns: 100, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("idempotence on resolved configs: merging a resolved config with itself is a fixpoint", () => {
    const prop = fc.property(resolvedConfig, (config) => {
      return canon(mergeExtends(config, config)) === canon(config);
    });
    expect(fc.assert(prop, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("empty child over plugin-less parent preserves the parent", () => {
    const prop = fc.property(
      fc.record({ account: WORD, domain: WORD, repository: WORD }),
      (parent) => {
        return canon(mergeExtends(parent, {})) === canon(parent);
      },
    );
    expect(fc.assert(prop, { numRuns: 100, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("child digest is atomic: parent fields never half-mix in", () => {
    const prop = fc.property(
      fc.record({
        digest: fc.record({ integrity: WORD, url: WORD, pin: fc.boolean(), extra: WORD }),
      }),
      fc.record({ digest: fc.record({ integrity: WORD, url: WORD }) }),
      (parent, child) => {
        const merged = mergeExtends(parent, child);
        const digest = (merged as Record<string, Json>).digest as Record<string, Json>;
        return canon(digest) === canon(child.digest) && !("extra" in digest) && !("pin" in digest);
      },
    );
    expect(fc.assert(prop, { numRuns: 150, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("app secrets/connectSrc union across extends: parent-first, complete, deduplicated", () => {
    const prop = fc.property(
      fc.array(WORD, { maxLength: 4 }),
      fc.array(WORD, { maxLength: 4 }),
      (parentList, childList) => {
        const parent = { app: { api: { secrets: parentList } } };
        const child = { app: { api: { secrets: childList } } };
        const merged = mergeExtends(parent, child);
        const mergedList = getPath(merged, ["app", "api", "secrets"]);
        return canon(mergedList) === canon(dedupParentFirst(parentList, childList));
      },
    );
    expect(fc.assert(prop, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("union of two empty arrays stays an empty array, not a deleted key", () => {
    const merged = mergeExtends(
      { app: { api: { secrets: [] } } },
      { app: { api: { secrets: [] } } },
    );
    expect(getPath(merged, ["app", "api", "secrets"])).toEqual([]);
  });

  it("plugin arrays do not union across extends: child list verbatim, deduplicated, parent never leaks", () => {
    const prop = fc.property(
      fc.array(WORD, { maxLength: 4 }),
      fc.array(WORD, { maxLength: 4 }),
      (parentList, childList) => {
        const parent = { plugins: { apps: { connectSrc: parentList } } };
        const child = { plugins: { apps: { connectSrc: childList } } };
        const merged = mergeExtends(parent, child);
        const mergedList = getPath(merged, ["plugins", "apps", "connectSrc"]);
        return canon(mergedList) === canon([...new Set(childList)] as Json[]);
      },
    );
    expect(fc.assert(prop, { numRuns: 150, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("plugins: child declaration replaces wholesale; parent never leaks into the cleaned list", () => {
    const prop = fc.property(
      fc.dictionary(WORD, jsonValue, { minKeys: 1, maxKeys: 4 }),
      fc.dictionary(WORD, jsonValue, { minKeys: 0, maxKeys: 4 }),
      (parentPlugins, childPlugins) => {
        const parent = { plugins: parentPlugins };
        const child = { plugins: childPlugins };
        const merged = mergeExtends(parent, child);
        const mergedPlugins = (merged as Record<string, Json>).plugins;
        return canon(mergedPlugins) === canon(cleanPluginsSection(childPlugins));
      },
    );
    expect(fc.assert(prop, { numRuns: 150, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("empty plugin attachment objects are dropped by the sentinel cleaner (documented edge)", () => {
    const merged = mergeExtends(
      { plugins: { example: { development: "local:plugins/example" } } },
      { plugins: { votes: {} } },
    );
    expect((merged as Record<string, Json>).plugins).toEqual({});
  });

  it("plugins: null sentinels in the child list are dropped", () => {
    const prop = fc.property(
      fc.dictionary(WORD, jsonValue, { minKeys: 1, maxKeys: 4 }),
      fc.array(WORD, { minLength: 1, maxLength: 3 }),
      (parentPlugins, sentinelIds) => {
        const childPlugins: Record<string, Json> = {};
        for (const id of new Set(sentinelIds)) childPlugins[id] = null;
        const parent = { plugins: parentPlugins };
        const child = { plugins: childPlugins };
        const merged = mergeExtends(parent, child);
        return canon((merged as Record<string, Json>).plugins) === canon({});
      },
    );
    expect(fc.assert(prop, { numRuns: 100, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("plugins: child without plugins inherits the parent list verbatim", () => {
    const prop = fc.property(
      fc.dictionary(WORD, jsonValue, { minKeys: 1, maxKeys: 4 }),
      fc.record({ account: WORD }),
      (parentPlugins, childRest) => {
        const parent = { plugins: parentPlugins };
        const merged = mergeExtends(parent, childRest);
        return canon((merged as Record<string, Json>).plugins) === canon(parentPlugins);
      },
    );
    expect(fc.assert(prop, { numRuns: 100, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("canonical key ordering for arbitrary merged configs", () => {
    const prop = fc.property(arbitraryConfig, arbitraryConfig, (a, b) => {
      const merged = mergeExtends(a, b) as Record<string, Json>;
      const keys = Object.keys(merged);
      const orderedKeys = BOS_CONFIG_ORDER.filter((key) => key in merged);
      const unknownKeys = keys.filter((key) => !BOS_CONFIG_ORDER.includes(key as never));
      return canon(keys) === canon([...orderedKeys, ...unknownKeys]);
    });
    expect(fc.assert(prop, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("rebuildOrderedConfig is idempotent", () => {
    const prop = fc.property(arbitraryConfig, (config) => {
      const once = rebuildOrderedConfig(config);
      return canon(rebuildOrderedConfig(once)) === canon(once);
    });
    expect(fc.assert(prop, { numRuns: 100, seed: PROPERTY_SEED })).toBeUndefined();
  });
});

describe("resolveExtendsRef laws", () => {
  const envArb = fc.constantFrom("development", "staging", "production");
  const refArb = fc.record(
    {
      development: fc.option(WORD, { nil: undefined }),
      staging: fc.option(WORD, { nil: undefined }),
      production: fc.option(WORD, { nil: undefined }),
    },
    { requiredKeys: false },
  );

  it("string refs are env-independent", () => {
    const prop = fc.property(WORD, envArb, (ref, env) => {
      return resolveExtendsRef(ref, env as "development") === ref;
    });
    expect(fc.assert(prop, { numRuns: 100, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("staging falls back through production", () => {
    const prop = fc.property(refArb, (ref) => {
      const expected = ref.staging ?? resolveExtendsRef(ref, "production");
      return resolveExtendsRef(ref, "staging") === expected;
    });
    expect(fc.assert(prop, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("precedence: env key, then production, then first defined value", () => {
    const prop = fc.property(refArb, envArb, (ref, env) => {
      const expected =
        ref[env as "development"] ??
        ref.production ??
        Object.values(ref).find((value) => Boolean(value)) ??
        undefined;
      return resolveExtendsRef(ref, env as "development") === expected;
    });
    expect(fc.assert(prop, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });
});

describe("publish canonicalization laws (#584, #865)", () => {
  const SLOT_ALPHA = ["apps", "registry", "example"] as const;

  const slotEntry: fc.Arbitrary<Json> = fc.record(
    {
      development: fc.option(
        fc.oneof(
          WORD.map((w) => `local:${w}`),
          WORD.map((w) => `https://${w}.example.com`),
        ),
        { nil: undefined },
      ),
      production: fc.option(
        WORD.map((w) => `https://${w}.example.com`),
        { nil: undefined },
      ),
      ui: fc.option(
        fc.record({
          development: fc.option(
            fc.oneof(
              WORD.map((w) => `local:${w}`),
              WORD.map((w) => `https://${w}.example.com`),
            ),
            { nil: undefined },
          ),
        }),
        { nil: undefined },
      ),
    },
    { requiredKeys: false },
  ) as fc.Arbitrary<Json>;

  const localRefConfig = fc.record(
    {
      account: WORD,
      seed: fc.option(fc.record({ version: WORD, steps: fc.array(WORD, { maxLength: 2 }) }), {
        nil: undefined,
      }),
      app: fc.record({ host: slotEntry, ui: slotEntry, api: slotEntry, auth: slotEntry }),
      plugins: fc.dictionary(fc.constantFrom(...SLOT_ALPHA), slotEntry, {
        minKeys: 1,
        maxKeys: 3,
      }),
    },
    { requiredKeys: false },
  );

  function collectDevelopmentValues(value: Json): Json[] {
    if (value === null || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(collectDevelopmentValues);
    const out: Json[] = [];
    for (const [key, val] of Object.entries(value)) {
      if (key === "development" && typeof val === "string") out.push(val);
      out.push(...collectDevelopmentValues(val));
    }
    return out;
  }

  it("published payload never carries a local: development target", () => {
    const prop = fc.property(localRefConfig, (config) => {
      const stripped = stripLocalDevelopmentTargets(config as unknown as BosConfigInput);
      const values = collectDevelopmentValues(stripped as unknown as Json);
      return values.every((value) => !(typeof value === "string" && value.startsWith("local:")));
    });
    expect(fc.assert(prop, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("stripping is idempotent", () => {
    const prop = fc.property(localRefConfig, (config) => {
      const once = stripLocalDevelopmentTargets(config as unknown as BosConfigInput);
      const twice = stripLocalDevelopmentTargets(once);
      return canon(once) === canon(twice);
    });
    expect(fc.assert(prop, { numRuns: 150, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("seed block never survives canonicalization", () => {
    const prop = fc.property(localRefConfig, (config) => {
      const stripped = stripSeedConfig(config as unknown as BosConfigInput);
      return !("seed" in (stripped as Record<string, Json>));
    });
    expect(fc.assert(prop, { numRuns: 100, seed: PROPERTY_SEED })).toBeUndefined();
  });
});

describe("mergeAuthoredOverPublished laws", () => {
  it("authored scalar wins at arbitrary paths", () => {
    const prop = fc.property(
      arbitraryConfig,
      arbitraryConfig,
      mergePath,
      scalarNoNull,
      scalarNoNull,
      (published, authored, path, publishedLeaf, authoredLeaf) => {
        const pub = setPath(published, path, publishedLeaf);
        const auth = setPath(authored, path, authoredLeaf);
        return getPath(overlayAuthored(pub, auth), path) === authoredLeaf;
      },
    );
    expect(fc.assert(prop, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("published-only top-level keys survive the overlay", () => {
    const prop = fc.property(arbitraryConfig, arbitraryConfig, (published, authored) => {
      const merged = overlayAuthored(published, authored) as Record<string, Json>;
      for (const key of Object.keys(published)) {
        if (key in (authored as Record<string, Json>)) continue;
        if (canon(merged[key]) !== canon(published[key])) return false;
      }
      return true;
    });
    expect(fc.assert(prop, { numRuns: 150, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("associativity under repeated overlays", () => {
    // Type-conflicting triples are exempt, mirroring the documented null
    // asymmetry below (#948): the overlay resolves a same-path conflict where
    // exactly one side is a plain object by wholesale replacement of the
    // non-object side (authored-wins), so with three overlays the replacement
    // order decides which shape survives and canonicalized results stop being
    // grouping-independent. Everything else (nulls included) stays in the law.
    const prop = fc
      .tuple(arbitraryConfig, arbitraryConfig, arbitraryConfig)
      .filter(
        ([p, a1, a2]) => typeCompatible(p, a1) && typeCompatible(a1, a2) && typeCompatible(p, a2),
      )
      .map(([p, a1, a2]) => ({ p, a1, a2 }));
    const law = fc.property(prop, ({ p, a1, a2 }) => {
      const left = overlayAuthored(overlayAuthored(p, a1), a2);
      const right = overlayAuthored(p, overlayAuthored(a1, a2));
      return canon(left) === canon(right);
    });
    expect(fc.assert(law, { numRuns: 200, seed: PROPERTY_SEED })).toBeUndefined();
  });

  it("associativity with shape conflicts fails by design: authored non-object wins, grouping decides which shape survives (documented, #948)", () => {
    const objectFirst = {
      p: { domain: { api: { api: [] } } } as Record<string, Json>,
      a1: { domain: { api: [] } } as Record<string, Json>,
      a2: { domain: { api: {} } } as Record<string, Json>,
    };
    const scalarFirst = {
      p: { extra: { connectSrc: { api: {} } } } as Record<string, Json>,
      a1: { extra: { connectSrc: false } } as Record<string, Json>,
      a2: { extra: { connectSrc: {} } } as Record<string, Json>,
    };

    for (const { p, a1, a2 } of [objectFirst, scalarFirst]) {
      const left = overlayAuthored(overlayAuthored(p, a1), a2);
      const right = overlayAuthored(p, overlayAuthored(a1, a2));
      expect(canon(left)).not.toBe(canon(right));
    }

    expect(
      getPath(overlayAuthored(overlayAuthored(objectFirst.p, objectFirst.a1), objectFirst.a2), [
        "domain",
        "api",
      ]),
    ).toEqual({});
    expect(getPath(overlayAuthored(objectFirst.p, objectFirst.a1), ["domain", "api"])).toEqual([]);
    expect(
      getPath(overlayAuthored(overlayAuthored(scalarFirst.p, scalarFirst.a1), scalarFirst.a2), [
        "extra",
        "connectSrc",
      ]),
    ).toEqual({});
    expect(
      getPath(overlayAuthored(scalarFirst.p, scalarFirst.a1), ["extra", "connectSrc"]),
    ).toEqual(false);
  });

  it("idempotence: overlaying a resolved snapshot with itself is a fixpoint", () => {
    const prop = fc.property(nullFreeConfig, (config) => {
      return canon(overlayAuthored(config, config)) === canon(config);
    });
    expect(fc.assert(prop, { numRuns: 150, seed: PROPERTY_SEED })).toBeUndefined();
  });
});
