import { Context, Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { docs as compiledDocs } from "../.velite/index.js";
import { contract } from "./contract";
import { ContextSchema } from "./lib/context";
import { type DocRecord, DocsService } from "./service";

class DocsServiceTag extends Context.Service<DocsServiceTag, DocsService>()("docs/DocsService") {}

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
  variables: z.object({}),

  secrets: z.object({}),

  context: ContextSchema,

  contract,

  initialize: () =>
    Effect.succeed(
      Layer.succeed(
        DocsServiceTag,
        new DocsService(
          compiledDocs.map((doc): DocRecord => {
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
          }),
        ),
      ),
    ),

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
