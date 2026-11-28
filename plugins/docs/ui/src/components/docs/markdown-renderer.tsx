import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import GithubSlugger from "github-slugger";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { resolveDocHref } from "./doc-links";

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

export interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

export function extractToc(content: string): TocEntry[] {
  const slugger = new GithubSlugger();
  const entries: TocEntry[] = [];
  for (const line of content.replace(/```[\s\S]*?```/g, "").split("\n")) {
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (!match) continue;
    const text = match[2]?.replace(/[*_`]/g, "").trim() ?? "";
    if (!text) continue;
    entries.push({ id: slugger.slug(text), text, depth: match[1]?.length === 2 ? 2 : 3 });
  }
  return entries;
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className ?? "");
  const lang = LANG_ALIASES[match?.[1] ?? ""] ?? match?.[1];
  const source = String(children ?? "").replace(/\n$/, "");
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const copy = () => {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!lang) {
    return <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">{children}</pre>;
  }
  return (
    <div className="relative my-4" data-testid="docs.code-block">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy code"}
        className="absolute top-2 right-2 z-10 rounded-md border border-border bg-card p-1.5 text-muted-foreground opacity-75 transition-colors hover:text-foreground hover:opacity-100"
        data-testid="docs.copy-code"
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </button>
      {html ? (
        <div
          className="overflow-x-auto rounded-lg border [&_pre]:bg-transparent [&_pre]:p-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto rounded-lg border bg-muted p-4 text-sm">{source}</pre>
      )}
    </div>
  );
}

const headingLevels = ["h1", "h2", "h3", "h4"] as const;

function Heading({
  level,
  children,
  id,
}: {
  level: string;
  children?: React.ReactNode;
  id?: string;
}) {
  const Tag = level as (typeof headingLevels)[number];
  return (
    <Tag id={id} className="group relative scroll-mt-6">
      {children}
      {id && (
        <a
          href={`#${id}`}
          aria-label="Link to this section"
          className="absolute top-1/2 -left-5 -translate-y-1/2 text-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          data-testid="docs.heading-anchor"
        >
          #
        </a>
      )}
    </Tag>
  );
}

export function MarkdownRenderer({ content, slug = "" }: { content: string; slug?: string }) {
  return (
    <div
      className="max-w-none text-foreground [&_a]:text-primary [&_a]:underline [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-[3px] [&_blockquote]:border-muted-foreground [&_blockquote]:bg-muted/60 [&_blockquote]:px-4 [&_blockquote]:py-2.5 [&_blockquote]:text-[0.93em] [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.86em] [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:tracking-wider [&_h3]:text-muted-foreground [&_h3]:uppercase [&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h5]:mt-4 [&_h5]:mb-1 [&_h5]:text-sm [&_h5]:font-medium [&_h6]:mt-4 [&_h6]:mb-1 [&_h6]:text-sm [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_pre]:not-italic [&_pre]:border-0 [&_pre]:bg-transparent [&_pre]:p-0 [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:w-full [&_table]:text-sm [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:bg-muted/60 [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-6"
      data-testid="docs.markdown"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={{
          a: ({ href, children }) => (
            <a href={href ? resolveDocHref(href, slug) : href}>{children}</a>
          ),
          table: ({ node: _node, children, ...props }) => (
            <div className="overflow-x-auto">
              <table {...props}>{children}</table>
            </div>
          ),
          h1: ({ children, id }) => (
            <Heading level="h1" id={id}>
              {children}
            </Heading>
          ),
          h2: ({ children, id }) => (
            <Heading level="h2" id={id}>
              {children}
            </Heading>
          ),
          h3: ({ children, id }) => (
            <Heading level="h3" id={id}>
              {children}
            </Heading>
          ),
          h4: ({ children, id }) => (
            <Heading level="h4" id={id}>
              {children}
            </Heading>
          ),
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
