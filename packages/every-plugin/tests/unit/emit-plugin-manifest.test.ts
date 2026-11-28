import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EmitPluginManifest } from "../../src/build/rspack/plugin";

/**
 * The manifest-stamping half of the additionalExports producer (#936):
 * EmitPluginManifest compiles the declared sources, stamps
 * additionalExports: [{ path, exports, sha256 }] into plugin.manifest.json,
 * and emits each declaration beside the bundle.
 */
const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

describe("EmitPluginManifest additionalExports stamping", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  const makeWorkspace = (withConfig: boolean): string => {
    const dir = mkdtempSync(join(tmpdir(), "emit-plugin-manifest-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        withConfig
          ? {
              name: "test-plugin",
              version: "1.0.0",
              "every-plugin": { additionalExports: ["src/auth-export.ts"] },
            }
          : { name: "test-plugin", version: "1.0.0" },
        null,
        2,
      ),
    );
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "contract.ts"),
      "export const contract = { route: (name: string) => name };\n",
    );
    if (withConfig) {
      writeFileSync(
        join(dir, "src", "auth-export.ts"),
        [
          "export type Auth = { session: boolean };",
          "export type AuthOrganization = { id: string };",
        ].join("\n"),
      );
    }
    return dir;
  };

  const compile = async (dir: string): Promise<Record<string, string>> => {
    const emitted: Record<string, string> = {};

    class RawSource {
      source: string;
      constructor(content: string) {
        this.source = content;
      }
    }

    const tap = { processAssets: null as (() => Promise<void>) | null };
    const compilation = {
      assets: [{ name: "remoteEntry.abc.js" }],
      hooks: {
        processAssets: {
          tapPromise: (_opts: unknown, fn: () => Promise<void>) => {
            tap.processAssets = fn;
          },
        },
      },
      emitAsset: (name: string, source: RawSource) => {
        emitted[name] = source.source;
      },
    };

    new EmitPluginManifest().apply({
      options: { context: dir },
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: (compilation: unknown) => void) => fn(compilation),
        },
      },
      webpack: {
        sources: { RawSource },
        Compilation: { PROCESS_ASSETS_STAGE_ADDITIONS: 1000 },
      },
    } as any);

    if (tap.processAssets) await tap.processAssets();
    return emitted;
  };

  it("stamps additionalExports with path, exports, and sha256, emitting the declaration beside the bundle", async () => {
    const dir = makeWorkspace(true);
    const emitted = await compile(dir);

    const manifest = JSON.parse(emitted["plugin.manifest.json"]!) as {
      contract: { types: { sha256: string } };
      additionalExports: Array<{ path: string; exports: string[]; sha256: string }>;
    };

    expect(manifest.contract.types.sha256).toBe(sha256(emitted["types/contract.d.ts"]!));
    expect(manifest.additionalExports).toEqual([
      {
        path: "./types/auth-export.d.ts",
        exports: expect.arrayContaining(["Auth", "AuthOrganization"]),
        sha256: sha256(emitted["types/auth-export.d.ts"]!),
      },
    ]);
    expect(emitted["types/auth-export.d.ts"]).toContain("export type Auth");
  });

  it("omits additionalExports when the workspace declares none", async () => {
    const dir = makeWorkspace(false);
    const emitted = await compile(dir);

    const manifest = JSON.parse(emitted["plugin.manifest.json"]!) as {
      additionalExports?: unknown;
    };
    expect(manifest.additionalExports).toBeUndefined();
  });
});
