import { CORE_UI_DEPLOY_FIELDS } from "every-plugin/build/ui";
import type { DeployResultEntry } from "./integrity";
import { applyDeployResults } from "./integrity";

/**
 * Image-native deploy entries (plan 043): the runtime image serves its own
 * staged artifacts at its own origin — the publish writes the deterministic
 * URLs, nothing is uploaded. Integrity is omitted: the published URL carries
 * the bytes' identity via the image build itself.
 */
export function platformUrlDeployEntries(input: {
  origin: string;
  account: string;
  gateway: string;
  key: string;
  kind: "app" | "plugin";
  integrity?: string;
  ssrIntegrity?: string;
}): DeployResultEntry[] {
  const { origin, account, gateway, key, kind, integrity, ssrIntegrity } = input;
  const slot = kind === "app" ? "app" : "plugins";
  const base = `${origin.replace(/\/$/, "")}/bundles/${account}/${gateway}/${key}/`;
  const entries: DeployResultEntry[] = [
    {
      url: base,
      integrity,
      urlField: `${slot}.${key}.production`,
      integrityField: `${slot}.${key}.integrity`,
    },
  ];

  if (kind === "app" && key === "ui") {
    entries.push({
      url: `${base}ssr/`,
      integrity: ssrIntegrity,
      urlField: CORE_UI_DEPLOY_FIELDS.ssrUrlField ?? "",
      integrityField: CORE_UI_DEPLOY_FIELDS.ssrIntegrityField ?? "",
    });
  }

  return entries;
}

/**
 * Single-plugin publish (image-native): build the plugin, then pin its
 * production URL to the runtime origin's namespace and drop any stale
 * integrity hash from the zephyr era.
 */
export function applyPluginPublishUrl(
  config: Record<string, unknown>,
  input: { origin: string; account: string; gateway: string; key: string },
): Record<string, unknown> {
  return applyDeployResults(config, platformUrlDeployEntries({ ...input, kind: "plugin" }));
}
