import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiContractResolver,
  type ApiPluginManifest,
  disposeApiContractResolver,
  fetchApiPluginManifest,
} from "../../src/api-contract";

function makeManifest(overrides?: Partial<ApiPluginManifest>): ApiPluginManifest {
  return {
    schemaVersion: 1,
    kind: "every-plugin/manifest",
    plugin: { name: "api", version: "1.0.0" },
    runtime: { remoteEntry: "http://api.cdn/remoteEntry.js" },
    ...overrides,
  };
}

const runWithResolver = async <A, E>(effect: Effect.Effect<A, E, ApiContractResolver>) =>
  Effect.runPromise(Effect.provide(effect, ApiContractResolver.layer));

describe("ApiContractResolver", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await disposeApiContractResolver();
  });

  it("manifest fetches and validates the every-plugin manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(makeManifest()), { status: 200 })),
    );
    const manifest = await runWithResolver(
      Effect.gen(function* () {
        const resolver = yield* ApiContractResolver;
        return yield* resolver.manifest("http://api.cdn");
      }),
    );
    expect(manifest.plugin.name).toBe("api");
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("http://api.cdn/plugin.manifest.json");
  });

  it("manifest fails tagged when the fetch yields nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );
    const error = await runWithResolver(
      Effect.gen(function* () {
        const resolver = yield* ApiContractResolver;
        return yield* resolver.manifest("http://fetch-null.cdn");
      }),
    ).then(
      () => null,
      (e) => e,
    );
    expect(error?._tag).toBe("ApiManifestFetchError");
    expect(error?.message).toBe(
      "Failed to fetch API plugin manifest from http://fetch-null.cdn/plugin.manifest.json",
    );
  });

  it("manifest fails tagged on an unsupported format", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 99 }), { status: 200 })),
    );
    const error = await runWithResolver(
      Effect.gen(function* () {
        const resolver = yield* ApiContractResolver;
        return yield* resolver.manifest("http://bad-format.cdn");
      }),
    ).then(
      () => null,
      (e) => e,
    );
    expect(error?._tag).toBe("ApiManifestFormatError");
    expect(error?.message).toBe("Unsupported API plugin manifest format");
  });

  it("fetchApiPluginManifest bridge preserves the thrown Error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );
    await expect(fetchApiPluginManifest("http://bridge.cdn")).rejects.toThrow(
      "Failed to fetch API plugin manifest from http://bridge.cdn/plugin.manifest.json",
    );
  });
});
