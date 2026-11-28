import { relative } from "node:path";
import { context, defineCollection, defineConfig, s, z } from "velite";

const prettify = (filePath: string): string =>
  filePath
    .replace(/\.(md|mdx)$/i, "")
    .split("/")
    .at(-1)!
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const firstHeading = (raw: string): string | undefined => {
  const match = /^#\s+(.+)$/m.exec(raw);
  return match?.[1]?.trim();
};

/** The current file's path relative to the content root, with forward slashes. */
const repoPath = (): string =>
  relative(context().config.root, context().file.path).replace(/\\/g, "/");

const isGlossary = (path: string): boolean => path.endsWith("GLOSSARY");

/**
 * Content root is the repository root, so one collection aggregates every
 * content source: the app's `docs` tree, the root `GLOSSARY.md`, and each
 * plugin's per-plugin docs tree (`plugins/<name>/docs`). Each compiled record
 * carries the source it came from (`app`, or the plugin's workspace name),
 * its repository file, and a mount-qualified slug — app docs keep their path
 * (`adr/0012-…`), plugin docs live under `plugins/<name>/…`, which is also
 * the public URL shape under /docs.
 *
 * Documents only: runnable prototype trees are repository examples, not
 * pages — they stay in git and are left out of the compiled corpus.
 *
 * Body text is flattened into a `search` field (code fences and markdown
 * syntax stripped) so list queries can match content, not just metadata.
 * Only raw markdown is emitted — rendering happens client-side through the
 * shared MarkdownRenderer.
 */
export default defineConfig({
  root: "../..",
  output: {
    data: ".velite",
    assets: ".velite/static",
    clean: true,
  },
  collections: {
    docs: defineCollection({
      name: "Doc",
      pattern: [
        "docs/**/*.md",
        "GLOSSARY.md",
        "plugins/*/docs/**/*.md",
        "!docs/plans/prototypes/**",
      ],
      schema: s.object({
        file: s.custom<string>().transform(repoPath),
        source: s.custom<string>().transform(() => {
          const pluginMatch = /^plugins\/([^/]+)\/docs\//.exec(repoPath());
          return pluginMatch?.[1] ?? "app";
        }),
        path: s.custom<string>().transform(() => {
          const within = repoPath()
            .replace(/^plugins\/[^/]+\/docs\//, "")
            .replace(/^docs\//, "");
          const withoutExtension = within.replace(/\.(md|mdx)$/i, "");
          return isGlossary(withoutExtension) ? "glossary" : withoutExtension;
        }),
        slug: s.custom<string>().transform(() => {
          const path = repoPath();
          const pluginMatch = /^plugins\/([^/]+)\/docs\/(.+)\.(md|mdx)$/i.exec(path);
          if (pluginMatch) return `plugins/${pluginMatch[1]}/${pluginMatch[2]}`;
          const withoutDocs = path.replace(/^docs\//, "").replace(/\.(md|mdx)$/i, "");
          return isGlossary(withoutDocs) ? "glossary" : withoutDocs;
        }),
        title: z
          .string()
          .optional()
          .transform((title) => {
            if (title) return title;
            // The glossary opens on the project's name, not its own.
            if (isGlossary(repoPath().replace(/\.(md|mdx)$/i, ""))) return "Glossary";
            return firstHeading(context().file.content ?? "") ?? prettify(context().file.path);
          }),
        description: z.string().optional(),
        tags: z.array(z.string()).default([]),
        order: z.number().default(100),
        raw: s.custom<string>().transform(() => context().file.content),
        search: s.custom<string>().transform(() =>
          (context().file.content ?? "")
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/`[^`]*`/g, " ")
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/[*_>|]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        ),
      }),
    }),
  },
});
