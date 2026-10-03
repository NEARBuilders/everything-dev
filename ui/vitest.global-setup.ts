import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateUiManifest } from "everything-dev/ui/manifest-generator";

/**
 * Fresh checkouts carry no generated route artifacts (`*.gen.*` are
 * gitignored). Regenerate them before the suite so the imports resolve.
 * A missing everything-dev build fails here too — but the suite would fail
 * on that import anyway, and `bun run dev`/`bos build` is the normal first run.
 */
export default async function setup(): Promise<void> {
  const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));
  try {
    await generateUiManifest({ workspaceRoot, pluginName: "ui" });
  } catch {
    // generated artifacts stay absent; the suite reports the underlying error
  }
}
