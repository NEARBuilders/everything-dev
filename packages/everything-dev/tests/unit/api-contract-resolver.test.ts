import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiContractResolver,
  type ApiPluginManifest,
  disposeApiContractResolver,
  fetchApiPluginManifest,
} from "../../src/services/codegen/api-contract";

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

  describe("authExportTypes", () => {
    const exportContent = `export type Auth = { session: boolean };
export type AuthOrganization = { id: string };
`;
    const exportSha256 = createHash("sha256").update(exportContent).digest("hex");
    const makeAuthManifest = (
      additionalExports?: ApiPluginManifest["additionalExports"],
    ): ApiPluginManifest =>
      makeManifest({
        plugin: { name: "auth", version: "2.0.0" },
        additionalExports,
      });

    let runtimeDir: string;
    const runAuthExport = async (manifest: ApiPluginManifest, baseUrl = "http://auth.cdn") => {
      runtimeDir = mkdtempSync(join(tmpdir(), "auth-export-resolver-"));
      return runWithResolver(
        Effect.gen(function* () {
          const resolver = yield* ApiContractResolver;
          return yield* resolver.authExportTypes({
            baseUrl,
            runtimeDir,
            manifest,
          });
        }),
      ).then(
        (path) => path,
        (error) => error,
      );
    };

    afterEach(() => {
      if (runtimeDir) {
        rmSync(runtimeDir, { recursive: true, force: true });
        runtimeDir = undefined!;
      }
    });

    it("fetches the manifest-entry file, verifies the checksum, and writes the generated d.ts", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(exportContent, { status: 200 })),
      );
      const result = (await runAuthExport(
        makeAuthManifest([
          {
            path: "./types/auth-export.d.ts",
            exports: ["Auth", "AuthOrganization"],
            sha256: exportSha256,
          },
        ]),
      )) as string;

      expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("http://auth.cdn/types/auth-export.d.ts");
      expect(result).toBe(join(runtimeDir, "auth", "auth-export.d.ts"));
      expect(readFileSync(result, "utf-8")).toBe(exportContent);
    });

    it("returns null without fetching when the manifest carries no auth-export entry", async () => {
      const fetchSpy = vi.fn(async () => new Response(exportContent, { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);

      const withoutEntry = await runAuthExport(makeAuthManifest(undefined));
      expect(withoutEntry).toBeNull();

      const otherEntryOnly = await runAuthExport(
        makeAuthManifest([{ path: "./types/other.d.ts", exports: ["Other"], sha256: "" }]),
      );
      expect(otherEntryOnly).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails tagged on a checksum mismatch", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(exportContent, { status: 200 })),
      );
      const error = (await runAuthExport(
        makeAuthManifest([
          {
            path: "./types/auth-export.d.ts",
            exports: ["Auth"],
            sha256: "0".repeat(64),
          },
        ]),
      )) as { _tag: string; message: string };

      expect(error._tag).toBe("AuthExportFetchError");
      expect(error.message).toContain("checksum mismatch");
      expect(existsSync(join(runtimeDir, "auth", "auth-export.d.ts"))).toBe(false);
    });

    it("fails tagged when the export file does not fetch", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("nope", { status: 404 })),
      );
      const error = (await runAuthExport(
        makeAuthManifest([
          {
            path: "./types/auth-export.d.ts",
            exports: ["Auth"],
            sha256: exportSha256,
          },
        ]),
      )) as { _tag: string; message: string };

      expect(error._tag).toBe("AuthExportFetchError");
      expect(error.message).toContain("404");
    });
  });
});
