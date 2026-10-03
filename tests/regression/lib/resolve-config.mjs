import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { openResolution } from "../../../packages/everything-dev/src/resolution/session.ts";

// Writes the resolved config the regression helpers read (the same file the
// build train's generateCodeArtifacts writes). Checkouts that never ran a
// bos command get it on demand — the Go/http legs without a build step need
// this before reset-plugin-dbs / regression-env run.
const root = resolve(import.meta.dirname, "../../..");
const session = await openResolution({ cwd: root, env: "development" });
if (!session?.config) {
  throw new Error("config resolution returned no config");
}
const out = join(root, ".bos", "bos.resolved-config.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(session.config, null, 2)}\n`);
console.log(`[resolve-config] wrote ${out}`);
