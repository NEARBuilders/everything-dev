import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Client-side markdown renderer shared by the public read route and (in a
 * later epic) the draft-editor preview — preview parity by construction.
 * Code highlighting runs through shiki's JavaScript regex engine (no WASM)
 * against a lazily built singleton with a fixed common-language set.
 */

const LANGS = [
  "tsx",
  "typescript",
  "json",
  "bash",
  "sql",
  "yaml",
  "css",
  "html",
  "markdown",
] as const;

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;

let highlighterPromise: Promise<Highlighter> | undefined;

function createHighlighter() {
  return Promise.all([
    import("shiki/core"),
    import("shiki/themes").then(({ bundledThemes }) => bundledThemes["github-dark"]!()),
    import("shiki/langs").then(({ bundledLanguages }) =>
      Promise.all(LANGS.map((lang) => bundledLanguages[lang]!())),
    ),
    import("shiki/engine/javascript"),
  ]).then(async ([{ createHighlighterCore }, theme, langs, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      themes: [theme.default],
      langs,
      engine: createJavaScriptRegexEngine(),
    }),
  );
}

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter();
  return highlighterPromise;
}

const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "typescript",
  shell: "bash",
  sh: "bash",
  yml: "yaml",
  md: "markdown",
  mdx: "markdown",
};

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className ?? "");
  const lang = LANG_ALIASES[match?.[1] ?? ""] ?? match?.[1];
  const source = String(children ?? "").replace(/\n$/, "");
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!lang) return;
    let alive = true;
    getHighlighter()
      .then((highlighter) => highlighter.codeToHtml(source, { lang, theme: "github-dark" }))
      .then((rendered) => {
        if (alive) setHtml(rendered);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lang, source]);

  if (!lang) {
    return <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">{children}</pre>;
  }
  if (!html) {
    return <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">{source}</pre>;
  }
  return (
    <div
      className="overflow-x-auto rounded-lg [&_pre]:bg-transparent [&_pre]:p-4"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div
      className="prose-base max-w-none text-foreground [&_a]:text-primary [&_a]:underline [&_blockquote]:border-border [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_hr]:border-border [&_li]:my-1 [&_p]:my-3 [&_pre]:not-italic [&_pre] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:w-full [&_table]:text-sm [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-6"
      data-testid="docs.markdown"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: (props) => {
            const { className, children } = props as {
              className?: string;
              children?: React.ReactNode;
            };
            if (className?.includes("language-")) {
              return <CodeBlock className={className}>{children}</CodeBlock>;
            }
            return <code>{children}</code>;
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
