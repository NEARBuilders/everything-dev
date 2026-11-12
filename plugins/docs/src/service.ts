import { Data, Effect } from "effect";

export interface DocRecord {
  slug: string;
  title: string;
  description?: string;
  tags: string[];
  order: number;
  raw: string;
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
  if (input.tag && !doc.tags.includes(input.tag)) return false;
  if (input.q) {
    const q = input.q.toLowerCase();
    const haystack = `${doc.title} ${doc.slug} ${doc.description ?? ""}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
};

const byOrderThenSlug = (a: DocRecord, b: DocRecord): number =>
  a.order - b.order || a.slug.localeCompare(b.slug);

/**
 * Docs Service — read-only access over build-time-compiled content
 * (velite output). No runtime state: content truth lives in the repository;
 * content changes land on the next build/deploy.
 */
export class DocsService {
  readonly docs: readonly DocRecord[];

  constructor(docs: readonly DocRecord[]) {
    this.docs = [...docs].sort(byOrderThenSlug);
  }

  list(input: ListDocsInput): Effect.Effect<ListDocsResult> {
    return Effect.sync(() => {
      const filtered = this.docs.filter((doc) => matches(doc, input));
      const offset = Math.min(cursorToOffset(input.cursor), filtered.length);
      const data = filtered.slice(offset, offset + input.limit);
      const hasMore = offset + input.limit < filtered.length;
      return {
        data,
        meta: {
          total: filtered.length,
          hasMore,
          nextCursor: hasMore ? offsetToCursor(offset + input.limit) : null,
        },
      } satisfies ListDocsResult;
    });
  }

  getBySlug(slug: string): Effect.Effect<DocRecord, DocNotFoundError> {
    return Effect.suspend(() => {
      const doc = this.docs.find((candidate) => candidate.slug === slug);
      return doc ? Effect.succeed(doc) : Effect.fail(new DocNotFoundError({ slug }));
    });
  }
}
