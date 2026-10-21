/**
 * Generate the in-image platform release manifest (ADR 0034 pt 1): the same
 * composer the deploy train publishes to FastKV, run inside the docker build
 * so both homes are byte-identical by construction. The file lands in
 * packages/everything-dev/dist — the runtime stage copies that package
 * wholesale, and `bos platform manifest` reads it from the known path.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { readFrameworkVersion } from "../packages/everything-dev/src/services/deploy/image";
import { readEveryPluginVersion } from "../packages/everything-dev/src/services/deploy/platform-manifest";
import {
  composePlatformReleaseManifest,
  computeTemplateInventory,
  serializePlatformReleaseManifest,
} from "../packages/everything-dev/src/services/platform/manifest";

const configDir = process.cwd();
const frameworkVersion = readFrameworkVersion(configDir);
const everyPluginVersion = readEveryPluginVersion(configDir);
if (!frameworkVersion || !everyPluginVersion) {
  throw new Error(
    "generate-platform-manifest: not a framework repo root — packages/everything-dev / packages/every-plugin versions missing",
  );
}

const workspaceYaml = parse(readFileSync(join(configDir, "pnpm-workspace.yaml"), "utf-8")) as {
  catalog?: Record<string, string>;
};

const manifest = composePlatformReleaseManifest({
  frameworkVersion,
  everyPluginVersion,
  imageRef: "ghcr.io/nearbuilders/everything-dev",
  catalog: workspaceYaml.catalog ?? {},
  templateInventory: computeTemplateInventory(configDir),
  compatMinChild: frameworkVersion,
});

const distDir = join(configDir, "packages", "everything-dev", "dist");
mkdirSync(distDir, { recursive: true });
writeFileSync(
  join(distDir, "platform-manifest.json"),
  `${serializePlatformReleaseManifest(manifest)}\n`,
);
console.log(
  `platform release manifest generated: ${manifest.frameworkVersion} (${manifest.templateInventory.length} inventory files)`,
);
