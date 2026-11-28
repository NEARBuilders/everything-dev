import { Effect, type Layer } from "effect";
import { buildScoped } from "every-plugin";
import { afterEach, describe, expect, it, vi } from "vitest";
import DocsPlugin, { DocsServiceTag } from "../../src/index";

const record = {
  slug: "hello",
  source: "remote-source",
  path: "hello",
  title: "Hello",
  tags: [],
  order: 1,
  raw: "# Hello",
  search: "hello body",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const serviceFromLayer = (layerEffect: unknown): Promise<any> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(
        layerEffect as Effect.Effect<Layer.Layer<any, any, never>, any, never>,
        (layer) => buildScoped(DocsServiceTag, layer),
      ),
    ),
  );

describe("docs plugin sources variable", () => {
  it("serves fetched content artifacts instead of the baked corpus", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://cdn.example.test/content/docs.json");
      return new Response(JSON.stringify([record]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = await serviceFromLayer(
      new DocsPlugin().initialize(
        {
          variables: {
            sources: [{ name: "remote-source", url: "https://cdn.example.test/content/docs.json" }],
          },
          secrets: {},
        } as never,
        {},
      ) as never,
    );

    const { data } = (await Effect.runPromise(service.list({ limit: 10 }))) as {
      data: Array<{ slug: string; source: string }>;
    };
    expect(data.map((doc) => doc.slug)).toEqual(["hello"]);
    expect(data[0]?.source).toBe("remote-source");
    const found = (await Effect.runPromise(service.getBySlug("hello"))) as { raw: string };
    expect(found.raw).toBe("# Hello");
  });

  it("keeps the baked corpus when no sources are declared", async () => {
    const service = await serviceFromLayer(
      new DocsPlugin().initialize(
        { variables: { sources: [] }, secrets: {} } as never,
        {},
      ) as never,
    );
    const { data } = (await Effect.runPromise(service.list({ limit: 5 }))) as {
      data: Array<{ source: string }>;
    };
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((doc) => doc.source === "app")).toBe(true);
  });

  it("fails loud when a declared artifact cannot be fetched", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.scoped(
          new DocsPlugin().initialize(
            {
              variables: {
                sources: [{ name: "app", url: "https://cdn.example.test/missing.json" }],
              },
              secrets: {},
            } as never,
            {},
          ) as never,
        ),
      ),
    );
    expect(exit._tag).toBe("Failure");
  });
});
