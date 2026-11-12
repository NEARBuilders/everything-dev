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

/**
 * Content root is the repository's docs tree (relative to this config file);
 * the glossary rides in from the repo root via an upward glob. Slugs are
 * path-derived (`GLOSSARY.md` → `glossary`, `adr/0012-*.md` → `adr/0012-*`);
 * titles fall back to the first heading, then a prettified filename.
 * Frontmatter honors title, description, tags, and order. Only raw markdown
 * is emitted — rendering happens client-side through the shared
 * MarkdownRenderer.
 */
export default defineConfig({
  root: "../../docs",
  output: {
    data: ".velite",
    assets: ".velite/static",
    clean: true,
  },
  collections: {
    docs: defineCollection({
      name: "Doc",
      pattern: ["**/*.md", "../GLOSSARY.md"],
      schema: s.object({
        slug: s.custom<string>().transform(() => {
          const { file, config } = context();
          const relativePath = relative(config.root, file.path).replace(/\\/g, "/");
          const withoutExtension = relativePath.replace(/\.(md|mdx)$/i, "");
          return withoutExtension.endsWith("GLOSSARY") ? "glossary" : withoutExtension;
        }),
        title: z
          .string()
          .optional()
          .transform(
            (title) =>
              title ?? firstHeading(context().file.content ?? "") ?? prettify(context().file.path),
          ),
        description: z.string().optional(),
        tags: z.array(z.string()).default([]),
        order: z.number().default(100),
        raw: s.custom<string>().transform(() => context().file.content),
      }),
    }),
  },
});
