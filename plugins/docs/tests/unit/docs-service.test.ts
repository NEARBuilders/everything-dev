import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DocNotFoundError, type DocRecord, DocsService } from "../../src/service";

const doc = (over: Partial<DocRecord> & { slug: string }): DocRecord => ({
  title: over.slug,
  tags: [],
  order: 100,
  raw: `# ${over.slug}`,
  ...over,
});

const fixtures: DocRecord[] = [
  doc({ slug: "glossary", title: "Glossary", order: 10, tags: ["reference"] }),
  doc({ slug: "adr/0012-session-gas-keys", title: "Session Gas Keys", order: 20, tags: ["adr"] }),
  doc({ slug: "agents/domain", title: "Domain docs", order: 30, tags: ["agents"] }),
  doc({ slug: "self-deploy", title: "Self deploy", order: 40, tags: ["ops", "guide"] }),
];

const service = () => new DocsService(fixtures);

describe("DocsService.list", () => {
  it("sorts by order then slug", async () => {
    const shuffled = new DocsService([...fixtures].reverse());
    const { data } = await Effect.runPromise(shuffled.list({ limit: 10 }));
    expect(data.map((d) => d.slug)).toEqual([
      "glossary",
      "adr/0012-session-gas-keys",
      "agents/domain",
      "self-deploy",
    ]);
  });

  it("filters by tag", async () => {
    const { data, meta } = await Effect.runPromise(service().list({ tag: "ops", limit: 10 }));
    expect(data.map((d) => d.slug)).toEqual(["self-deploy"]);
    expect(meta.total).toBe(1);
  });

  it("filters by query against title and slug, case-insensitively", async () => {
    const byTitle = await Effect.runPromise(service().list({ q: "GAS KEYS", limit: 10 }));
    expect(byTitle.data.map((d) => d.slug)).toEqual(["adr/0012-session-gas-keys"]);
    const bySlug = await Effect.runPromise(service().list({ q: "gloss", limit: 10 }));
    expect(bySlug.data.map((d) => d.slug)).toEqual(["glossary"]);
    const none = await Effect.runPromise(service().list({ q: "zzz", limit: 10 }));
    expect(none.data).toEqual([]);
    expect(none.meta.total).toBe(0);
  });

  it("paginates with an opaque cursor that walks every item exactly once", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let guard = 0;
    while (guard++ < 10) {
      const page = await Effect.runPromise(service().list({ limit: 2, cursor }));
      seen.push(...page.data.map((d) => d.slug));
      if (!page.meta.hasMore) {
        expect(page.meta.nextCursor).toBeNull();
        break;
      }
      expect(page.meta.nextCursor).toBeTruthy();
      cursor = page.meta.nextCursor ?? undefined;
    }
    expect(seen).toEqual(["glossary", "adr/0012-session-gas-keys", "agents/domain", "self-deploy"]);
    expect(guard).toBeLessThan(10);
  });

  it("never repeats items across a page boundary", async () => {
    const page1 = await Effect.runPromise(service().list({ limit: 3, cursor: undefined }));
    const page2 = await Effect.runPromise(
      service().list({ limit: 3, cursor: page1.meta.nextCursor ?? undefined }),
    );
    const slugs = new Set([...page1.data, ...page2.data].map((d) => d.slug));
    expect(slugs.size).toBe(4);
  });
});

describe("DocsService.getBySlug", () => {
  it("returns the full record including raw markdown", async () => {
    const found = await Effect.runPromise(service().getBySlug("self-deploy"));
    expect(found.title).toBe("Self deploy");
    expect(found.raw).toContain("# self-deploy");
    expect(found.tags).toEqual(["ops", "guide"]);
  });

  it("fails with DocNotFoundError for an unknown slug", async () => {
    const failure = await Effect.runPromise(service().getBySlug("nope").pipe(Effect.flip));
    expect(failure).toBeInstanceOf(DocNotFoundError);
  });
});
