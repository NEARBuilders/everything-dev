/**
 * The authored `bos.app.ts` source emitter — the scaffold surface of the
 * descriptor module. The descriptor is pure data (`toConfigInput` and its
 * inverse live in `./resolve`), so the scaffold emits the personalized
 * descriptor as a literal inside the `App()` call; publish/sync still
 * canonicalize the resolved config to JSON for FastKV.
 *
 * Each top-level descriptor field gets a one-line doc comment from
 * `FIELD_COMMENTS`; when a field is added to the descriptor schema, add its
 * comment line in the same commit. Fields without a comment entry are
 * emitted bare.
 */

import type { BosConfigInput } from "../types";
import { configInputToDescriptor } from "./resolve";

const FIELD_COMMENTS: Record<string, string> = {
  extends:
    "The base runtime this app extends — inherit the platform, override only what you change.",
  account: "The NEAR account this app publishes under.",
  domain: "The gateway: FastKV lookup key and public ingress for this runtime.",
  title: "Human-readable runtime title (surfaced by the UI).",
  description: "Human-readable runtime description.",
  repository: "GitHub repository tarball source used by `bos init`/`bos sync` templates.",
  testnet: "Testnet identity for this runtime.",
  staging: "Staging environment identity.",
  starter: "Authoring-only: the starter level this child was scaffolded with (simple | advanced).",
  ci: "CI settings: runtime image name, Railway service.",
  cdn: "CDN origin serving this runtime's built bundles.",
  publish: "Publish settings: signing mode (session | key | custody).",
  host: "Local host workspace override.",
  api: "Local API workspace override.",
  ui: "Local UI workspace override.",
  auth: "Auth attachment — lands in the app.auth slot (e.g. the Better-Auth + NEAR SIWN plugin).",
  plugins:
    "Attached plugins, keyed by registry key. `path` = local workspace, `extends` = published module.",
};

/** The authored `bos.app.ts` source for a personalized child config. */
export function serializeAppDescriptorSource(input: BosConfigInput): string {
  const descriptor = configInputToDescriptor(input);
  const blocks: string[] = [];
  for (const [key, value] of Object.entries(descriptor)) {
    const comment = FIELD_COMMENTS[key];
    const body = JSON.stringify({ [key]: value }, null, 2);
    const block = [...(comment ? [`  // ${comment}`] : []), ...body.split("\n").slice(1, -1)];
    blocks.push(block.join("\n"));
  }
  return `import { App } from "everything-dev/descriptor";

// Authored app descriptor. The published config is canonicalized to JSON
// from this file; dev-only overrides live in bos.dev.ts (never published).
export default App({
${blocks.join(",\n")},
});
`;
}
