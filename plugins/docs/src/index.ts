import { Context, Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { docs as compiledDocs } from "../.velite/index.js";
import { contract } from "./contract";
import { ContextSchema } from "./lib/context";
import { type DocRecord, DocsService } from "./service";

class DocsServiceTag extends Context.Service<DocsServiceTag, DocsService>()("docs/DocsService") {}

export { DocsServiceTag };

/**
 * The compiled record's runtime shape (the velite collection output, local
 * or fetched): the parsed JSON's fields are untrusted at the type level.
 */
const compiledRecordSchema = z.object({
  slug: z.string(),
  source: z.string().optional(),
  path: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  order: z.number().optional(),
  raw: z.string().optional(),
  search: z.string().optional(),
});

type CompiledRecord = z.infer<typeof compiledRecordSchema>;

const toRecord = (doc: CompiledRecord): DocRecord => {
  const { slug, source, path, description, raw, search } = doc;
  return {
    slug,
    source: source ?? "app",
    path: path ?? slug,
    title: doc.title ?? slug,
    description,
    tags: doc.tags ?? [],
    order: doc.order ?? 100,
    raw: raw ?? "",
    search,
  };
};

/**
 * Docs Plugin — docs-as-code over the repository's own markdown.
 *
 * Content truth is the repository: velite compiles the app's `docs` tree,
 * the root `GLOSSARY.md`, and every plugin's per-plugin docs tree at build
 * time (rspack beforeCompile hook via `build.config.ts`), and this plugin
 * serves the compiled result read-only. Slugs are mount-qualified — app docs
 * at the root, plugin docs under `plugins/<name>/…` — so a plugin ships its
 * docs lane by dropping a `docs/` folder in its workspace. No database, no
 * secrets — content changes land on the next build/deploy.
 *
 * Context fields available from the host are described in lib/context.ts;
 * the read surface is gate-free and needs none of them.
 */
export default createPlugin({
  variables: z.object({
    /**
     * Content sources served instead of the baked bundle (ADR 0052) —
     * compiled collection JSONs published as content artifacts, one per
     * source. Absent/empty: the baked corpus the plugin was built with.
     */
    sources: z
      .array(
        z.object({
          name: z.string().describe("Content source name — app, or the publishing plugin's id"),
          url: z.string().url().describe("The compiled collection's published artifact URL"),
        }),
      )
      .default([]),
  }),

  secrets: z.object({}),

  context: ContextSchema,

  contract,

  initialize: ({ variables }) =>
    Effect.gen(function* () {
      const records: DocRecord[] = yield* Effect.tryPromise({
        try: async () => {
          if (variables.sources.length === 0) {
            return compiledDocs.map(toRecord);
          }
          const sources = await Promise.all(
            variables.sources.map(async (source) => {
              const response = await fetch(source.url, {
                signal: AbortSignal.timeout(15_000),
              });
              if (!response.ok) {
                throw new Error(
                  `content source ${source.name} (${source.url}) returned ${response.status}`,
                );
              }
              const compiled = (await response.json()) as CompiledRecord[];
              return compiled.map(toRecord);
            }),
          );
          return sources.flat();
        },
        catch: (error) => new Error(`${error instanceof Error ? error.message : String(error)}`),
      });
      return Layer.succeed(DocsServiceTag, new DocsService(records));
    }),

  createRouter: (builder) => {
    return {
      listPublished: builder.listPublished.effect(function* ({ input }) {
        const docs = yield* DocsServiceTag;
        return yield* docs.list(input);
      }),

      getBySlug: builder.getBySlug.effect(function* ({ input, errors }) {
        const docs = yield* DocsServiceTag;
        const doc = yield* docs
          .getBySlug(input.slug)
          .pipe(Effect.mapError((error) => errors.NOT_FOUND({ message: error.message })));
        return { doc };
      }),

      getNav: builder.getNav.effect(function* () {
        const docs = yield* DocsServiceTag;
        return { nav: yield* docs.getNav() };
      }),
    };
  },
});
