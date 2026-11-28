import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DocNotFoundError, type DocRecord, DocsService } from "../../src/service";

const doc = (over: Partial<DocRecord> & { slug: string }): DocRecord => ({
  source: "app",
  path: over.slug,
  title: over.slug,
  tags: [],
  order: 100,
  raw: `# ${over.slug}`,
  ...over,
});

const fixtures: DocRecord[] = [
  doc({ slug: "glossary", title: "Glossary", order: 10, tags: ["reference"] }),
  doc({
    slug: "adr/0012-session-gas-keys",
    title: "Session Gas Keys",
    order: 20,
    tags: ["adr"],
    search: "session gas keys rotate nonce lanes without a relayer on the hot path",
  }),
  doc({ slug: "agents/domain", title: "Domain docs", order: 30, tags: ["agents"] }),
  doc({ slug: "self-deploy", title: "Self deploy", order: 40, tags: ["ops", "guide"] }),
  doc({
    source: "auth",
    path: "install",
    slug: "plugins/auth/install",
    title: "Auth install",
    order: 5,
  }),
];

const service = () => new DocsService(fixtures);

describe("DocsService.list", () => {
  it("sorts by order then slug", async () => {
    const shuffled = new DocsService([...fixtures].reverse());
    const { data } = await Effect.runPromise(shuffled.list({ limit: 10 }));
    expect(data.map((d) => d.slug)).toEqual([
      "plugins/auth/install",
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

  it("filters by content source", async () => {
    const { data, meta } = await Effect.runPromise(service().list({ source: "auth", limit: 10 }));
    expect(data.map((d) => d.slug)).toEqual(["plugins/auth/install"]);
    expect(meta.total).toBe(1);
    const app = await Effect.runPromise(service().list({ source: "app", limit: 10 }));
    expect(app.data.every((d) => d.source === "app")).toBe(true);
    expect(app.meta.total).toBe(4);
  });

  it("filters by query against title, slug and description", async () => {
    const byTitle = await Effect.runPromise(service().list({ q: "GAS KEYS", limit: 10 }));
    expect(byTitle.data.map((d) => d.slug)).toEqual(["adr/0012-session-gas-keys"]);
    const bySlug = await Effect.runPromise(service().list({ q: "gloss", limit: 10 }));
    expect(bySlug.data.map((d) => d.slug)).toEqual(["glossary"]);
  });

  it("matches queries against body text, not just metadata", async () => {
    const hit = await Effect.runPromise(service().list({ q: "rotate nonce lanes", limit: 10 }));
    expect(hit.data.map((d) => d.slug)).toEqual(["adr/0012-session-gas-keys"]);
    const miss = await Effect.runPromise(service().list({ q: "quantum entanglement", limit: 10 }));
    expect(miss.data).toEqual([]);
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
    expect(seen).toEqual([
      "plugins/auth/install",
      "glossary",
      "adr/0012-session-gas-keys",
      "agents/domain",
      "self-deploy",
    ]);
    expect(guard).toBeLessThan(10);
  });

  it("never repeats items across a page boundary", async () => {
    const page1 = await Effect.runPromise(service().list({ limit: 3, cursor: undefined }));
    const page2 = await Effect.runPromise(
      service().list({ limit: 3, cursor: page1.meta.nextCursor ?? undefined }),
    );
    const slugs = new Set([...page1.data, ...page2.data].map((d) => d.slug));
    expect(slugs.size).toBe(5);
  });
});

describe("DocsService.getBySlug", () => {
  it("resolves a directory to its README index page", async () => {
    const withReadme = new DocsService([
      doc({ slug: "adr/README", title: "Architecture Decision Records", order: 5 }),
      doc({ slug: "adr/0001-first", title: "First ADR", order: 10 }),
    ]);
    const index = await Effect.runPromise(withReadme.getBySlug("adr"));
    expect(index.title).toBe("Architecture Decision Records");
    expect(index.slug).toBe("adr/README");
  });

  it("returns the full record including raw markdown", async () => {
    const found = await Effect.runPromise(service().getBySlug("self-deploy"));
    expect(found.raw).toBe("# self-deploy");
    expect(found.source).toBe("app");
  });

  it("resolves mount-qualified plugin slugs", async () => {
    const found = await Effect.runPromise(service().getBySlug("plugins/auth/install"));
    expect(found.title).toBe("Auth install");
    expect(found.source).toBe("auth");
    expect(found.path).toBe("install");
  });

  it("fails with a tagged error for unknown slugs", async () => {
    const error = await Effect.runPromise(service().getBySlug("nope").pipe(Effect.flip));
    expect(error).toBeInstanceOf(DocNotFoundError);
    expect(error.slug).toBe("nope");
  });
});

describe("DocsService.getNav", () => {
  it("builds one directory node per slug segment, with pages at leaves", async () => {
    const nav = await Effect.runPromise(service().getNav());
    const labels = nav.map((node) => node.label);
    expect(labels).toContain("Plugins");
    expect(labels).toContain("ADR");

    const plugins = nav.find((node) => node.label === "Plugins");
    expect(plugins?.children.map((child) => child.label)).toEqual(["Auth"]);
    expect(plugins?.children[0]?.children[0]?.slug).toBe("plugins/auth/install");
  });

  it("orders directories by their subtree minimum", async () => {
    const nav = await Effect.runPromise(service().getNav());
    const labels = nav.map((node) => node.label);
    expect(labels).toEqual(["Plugins", "Glossary", "ADR", "Agents", "Self deploy"]);
  });

  it("flattens pages in tree order for prev/next", () => {
    const flat = service().flattenNav();
    expect(flat.map((entry) => entry.slug)).toEqual([
      "plugins/auth/install",
      "glossary",
      "adr/0012-session-gas-keys",
      "agents/domain",
      "self-deploy",
    ]);
  });

  it("records each directory's qualified path for ancestor expansion", async () => {
    const nav = await Effect.runPromise(service().getNav());
    const plugins = nav.find((node) => node.label === "Plugins");
    expect(plugins?.path).toBe("plugins");
    expect(plugins?.children[0]?.path).toBe("plugins/auth");
    expect(plugins?.children[0]?.children[0]?.path).toBe("");
  });
});

describe("DocsService mount shadowing", () => {
  it("a mounted plugin source shadows an app page at the same qualified slug", async () => {
    const shadowed = new DocsService([
      doc({ slug: "plugins/auth/install", title: "App-authored auth page" }),
      doc({
        source: "auth",
        path: "install",
        slug: "plugins/auth/install",
        title: "Plugin-authored auth page",
      }),
    ]);
    const found = await Effect.runPromise(shadowed.getBySlug("plugins/auth/install"));
    expect(found.title).toBe("Plugin-authored auth page");
    const { meta } = await Effect.runPromise(shadowed.list({ limit: 10 }));
    expect(meta.total).toBe(1);
  });

  it("keeps the app page when no plugin source claims the mount", async () => {
    const nav = await Effect.runPromise(service().getNav());
    const plugins = nav.find((node) => node.label === "Plugins");
    expect(plugins?.children.map((child) => child.label)).toEqual(["Auth"]);
  });
});
