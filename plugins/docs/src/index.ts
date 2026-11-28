import { Context, Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { docs as compiledDocs } from "../.velite/index.js";
import { contract } from "./contract";
import { ContextSchema } from "./lib/context";
import { type DocRecord, DocsService, fileOfSlug } from "./service";

class DocsServiceTag extends Context.Service<DocsServiceTag, DocsService>()("docs/DocsService") {}

export { DocsServiceTag };

const compiledRecordSchema = z.object({
  slug: z.string(),
  file: z.string().optional(),
  source: z.string().optional(),
  path: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  order: z.number().optional(),
  status: z.string().optional(),
  statusNote: z.string().optional(),
  raw: z.string().optional(),
  search: z.string().optional(),
});

type CompiledRecord = z.infer<typeof compiledRecordSchema>;

const toRecord = (doc: CompiledRecord): DocRecord => {
  const { slug, source, path, description, raw, search } = doc;
  const resolvedSource = source ?? "app";
  return {
    slug,
    source: resolvedSource,
    path: path ?? slug,
    file: doc.file ?? fileOfSlug(slug, resolvedSource),
    title: doc.title ?? slug,
    description,
    tags: doc.tags ?? [],
    order: doc.order ?? 100,
    status: doc.status,
    statusNote: doc.statusNote,
    raw: raw ?? "",
    search,
  };
};

export default createPlugin({
  variables: z.object({
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
