import { Data, Effect } from "effect";

import { prettifySegment } from "./lib/labels";

export interface DocRecord {
  readonly source: string;
  readonly path: string;
  readonly slug: string;
  readonly title: string;
  readonly description?: string;
  readonly tags: string[];
  readonly order: number;
  readonly raw: string;
  readonly search?: string;
}

export interface NavNode {
  label: string;
  slug: string | null;
  title: string | null;
  order: number;
  path: string;
  children: NavNode[];
}

export class DocNotFoundError extends Data.TaggedError("DocNotFoundError")<{
  readonly slug: string;
}> {
  override get message() {
    return `Doc not found: ${this.slug}`;
  }
}

export interface ListDocsInput {
  readonly q?: string;
  readonly tag?: string;
  readonly source?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListDocsResult {
  readonly data: DocRecord[];
  readonly meta: {
    readonly total: number;
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
  };
}

const cursorToOffset = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const offset = Number(decoded);
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
};

const offsetToCursor = (offset: number): string => Buffer.from(String(offset)).toString("base64");

const matches = (doc: DocRecord, input: ListDocsInput): boolean => {
  if (input.source && doc.source !== input.source) return false;
  if (input.tag && !doc.tags.includes(input.tag)) return false;
  if (input.q) {
    const q = input.q.toLowerCase();
    const haystack = `${doc.title} ${doc.slug} ${doc.description ?? ""} ${doc.search ?? doc.raw}`;
    if (!haystack.toLowerCase().includes(q)) return false;
  }
  return true;
};

const compareNodes = (a: NavNode, b: NavNode): number =>
  a.order - b.order || a.label.localeCompare(b.label);

const buildNav = (docs: readonly DocRecord[]): NavNode[] => {
  const root: NavNode = { label: "", slug: null, title: null, order: 0, path: "", children: [] };
  for (const doc of docs) {
    const segments = doc.slug.split("/");
    let node = root;
    let dirPath = "";
    for (let i = 0; i < segments.length - 1; i += 1) {
      const label = prettifySegment(segments[i] ?? "");
      dirPath = dirPath ? `${dirPath}/${segments[i]}` : (segments[i] ?? "");
      let child = node.children.find(
        (candidate) => candidate.slug === null && candidate.label === label,
      );
      if (!child) {
        child = {
          label,
          slug: null,
          title: null,
          order: Number.POSITIVE_INFINITY,
          path: dirPath,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
    node.children.push({
      label: doc.title,
      slug: doc.slug,
      title: doc.title,
      order: doc.order,
      path: "",
      children: [],
    });
  }
  const sortTree = (node: NavNode): void => {
    for (const child of node.children) sortTree(child);
    node.children.sort(compareNodes);
    if (node.slug === null && node.children.length > 0) {
      node.order = Math.min(...node.children.map((child) => child.order));
    }
  };
  sortTree(root);
  return root.children;
};

export class DocsService {
  private readonly docs: readonly DocRecord[];
  private readonly bySlug: Map<string, DocRecord>;
  private readonly nav: NavNode[];

  constructor(records: readonly DocRecord[]) {
    const pluginSlugs = new Set(
      records.filter((doc) => doc.source !== "app").map((doc) => doc.slug),
    );
    const docs = records
      .filter((doc) => doc.source !== "app" || !pluginSlugs.has(doc.slug))
      .slice()
      .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
    this.docs = docs;
    this.bySlug = new Map(docs.map((doc) => [doc.slug, doc]));
    this.nav = buildNav(docs);
  }

  list(input: ListDocsInput): Effect.Effect<ListDocsResult> {
    return Effect.sync(() => {
      const matching = this.docs.filter((doc) => matches(doc, input));
      const start = cursorToOffset(input.cursor);
      const page = matching.slice(start, start + input.limit);
      const hasMore = start + input.limit < matching.length;
      return {
        data: page,
        meta: {
          total: matching.length,
          hasMore,
          nextCursor: hasMore ? offsetToCursor(start + input.limit) : null,
        },
      };
    });
  }

  getBySlug(slug: string): Effect.Effect<DocRecord, DocNotFoundError> {
    const bySlug = this.bySlug;
    return Effect.gen(function* () {
      const doc = bySlug.get(slug) ?? bySlug.get(`${slug}/README`);
      if (!doc) return yield* new DocNotFoundError({ slug });
      return doc;
    });
  }

  getNav(): Effect.Effect<NavNode[]> {
    return Effect.succeed(this.nav);
  }

  flattenNav(): { slug: string; title: string }[] {
    const out: { slug: string; title: string }[] = [];
    const walk = (nodes: readonly NavNode[]): void => {
      for (const node of nodes) {
        if (node.slug) out.push({ slug: node.slug, title: node.title ?? node.label });
        walk(node.children);
      }
    };
    walk(this.nav);
    return out;
  }
}
