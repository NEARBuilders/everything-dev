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

const STATUS_LINE = /(?:^|\s)Status:[ \t]*(.+?)[ \t]*$/im;

const statusMeta = (raw: string): { status?: string; statusNote?: string } => {
  const header = (raw ?? "").split(/\n## /)[0] ?? "";
  const match = STATUS_LINE.exec(header);
  if (!match) return {};
  const value = (match[1] ?? "").trim();
  if (!value) return {};

  let depth = 0;
  let parenStart = -1;
  let cut = -1;
  let cutBy = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i] ?? "";
    if (ch === "(") {
      if (depth === 0 && parenStart === -1) parenStart = i;
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
    } else if (depth === 0 && cut === -1) {
      if ("—–;·".includes(ch)) {
        cut = i;
      } else if (ch === " " && /^by[\s(]/i.test(value.slice(i + 1))) {
        cut = i;
        cutBy = true;
      }
    }
  }
  if (cut === -1) cut = value.length;

  const stopAt = Math.min(cut, parenStart === -1 ? value.length : parenStart);
  const status = value.slice(0, stopAt).replace(/\s+/g, " ").trim().toLowerCase();
  if (!status) return {};
  const paren =
    parenStart === -1 ? undefined : /\(([^)]*)\)/.exec(value.slice(parenStart))?.[1]?.trim();
  const rest = (cut < value.length ? value.slice(cut) : "")
    .replace(/^\s*[—–;·(]*\s*/, "")
    .replace(/^by[\s]+/i, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const restNote = rest ? (cutBy ? `by ${rest}` : rest) : "";
  const statusNote = [restNote, paren].filter(Boolean).join(" — ");
  return { status, statusNote: statusNote || undefined };
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
        status: z
          .string()
          .optional()
          .transform(() => statusMeta(context().file.content ?? "").status),
        statusNote: z
          .string()
          .optional()
          .transform(() => statusMeta(context().file.content ?? "").statusNote),
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
