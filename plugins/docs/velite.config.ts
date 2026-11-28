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
      pattern: ["docs/**/*.md", "GLOSSARY.md", "plugins/*/docs/**/*.md"],
      schema: s.object({
        source: s.custom<string>().transform(() => {
          const path = relative(context().config.root, context().file.path).replace(/\\/g, "/");
          const pluginMatch = /^plugins\/([^/]+)\/docs\//.exec(path);
          return pluginMatch?.[1] ?? "app";
        }),
        path: s.custom<string>().transform(() => {
          const path = relative(context().config.root, context().file.path).replace(/\\/g, "/");
          const within = path.replace(/^plugins\/[^/]+\/docs\//, "").replace(/^docs\//, "");
          const withoutExtension = within.replace(/\.(md|mdx)$/i, "");
          return withoutExtension.endsWith("GLOSSARY") ? "glossary" : withoutExtension;
        }),
        slug: s.custom<string>().transform(() => {
          const path = relative(context().config.root, context().file.path).replace(/\\/g, "/");
          const pluginMatch = /^plugins\/([^/]+)\/docs\/(.+)\.(md|mdx)$/i.exec(path);
          if (pluginMatch) return `plugins/${pluginMatch[1]}/${pluginMatch[2]}`;
          const withoutDocs = path.replace(/^docs\//, "").replace(/\.(md|mdx)$/i, "");
          return withoutDocs.endsWith("GLOSSARY") ? "glossary" : withoutDocs;
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
