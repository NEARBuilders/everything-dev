import { CORE_UI_DEPLOY_FIELDS } from "every-plugin/build/ui";
import type { DeployResultEntry } from "./integrity";

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
  /** the workspace's uploaded version manifest: filename (relative to the
   * bundle base) + its own SRI — written as the remote's `digest` */
  digest?: { file: string; integrity: string };
}): DeployResultEntry[] {
  const { origin, account, gateway, key, kind, integrity, ssrIntegrity, digest } = input;
  const section = kind === "app" ? "app" : "plugins";
  const base = `${origin.replace(/\/$/, "")}/bundles/${account}/${gateway}/${key}/`;
  const entries: DeployResultEntry[] = [
    {
      url: base,
      ...(digest
        ? {
            value: digest.file,
            valueField: `${section}.${key}.digest.manifest`,
            integrity: digest.integrity,
            integrityField: `${section}.${key}.digest.integrity`,
            // the remote's identity is the digest — a stale direct entry
            // SRI, retired flat manifest pointer, or the pre-cutover `pin`
            // stamp must not linger
            removeFields: [
              `${section}.${key}.integrity`,
              `${section}.${key}.manifest`,
              `${section}.${key}.pin.manifest`,
              `${section}.${key}.pin.integrity`,
            ],
          }
        : {
            integrity,
            integrityField: `${section}.${key}.integrity`,
            removeFields: [
              `${section}.${key}.manifest`,
              `${section}.${key}.pin.manifest`,
              `${section}.${key}.pin.integrity`,
            ],
          }),
      urlField: `${section}.${key}.production`,
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
 * Folder-form plugin ui deploy entries: the plugin's ui surface builds to
 * `<plugin>/ui/dist` (web remoteEntry + ssr container) and uploads as its own
 * bundle key (`<key>-ui`), pinning `<section>.<key>.ui.*` in bos.config.json.
 * Without these entries a deployed plugin ui resolves with no production URL
 * and the host cannot compose (or even address) its routes.
 */
export function pluginUiUrlDeployEntries(input: {
  origin: string;
  account: string;
  gateway: string;
  key: string;
  kind: "app" | "plugin";
  integrity?: string;
  ssrIntegrity?: string;
  /** the uploaded version manifest: filename + its own SRI — written as the
   * ui remote's `digest` */
  digest?: { file: string; integrity: string };
  /** The built MF container name — remote boots need it pinned in the config. */
  name?: string;
}): DeployResultEntry[] {
  const { origin, account, gateway, key, kind, integrity, ssrIntegrity, digest, name } = input;
  const section = kind === "app" ? "app" : "plugins";
  const base = `${origin.replace(/\/$/, "")}/bundles/${account}/${gateway}/${key}-ui/`;
  const entries: DeployResultEntry[] = [
    {
      url: base,
      ...(digest
        ? {
            value: digest.file,
            valueField: `${section}.${key}.ui.digest.manifest`,
            integrity: digest.integrity,
            integrityField: `${section}.${key}.ui.digest.integrity`,
            removeFields: [
              `${section}.${key}.ui.integrity`,
              `${section}.${key}.ui.manifest`,
              `${section}.${key}.ui.pin.manifest`,
              `${section}.${key}.ui.pin.integrity`,
            ],
          }
        : {
            integrity,
            integrityField: `${section}.${key}.ui.integrity`,
            removeFields: [
              `${section}.${key}.ui.manifest`,
              `${section}.${key}.ui.pin.manifest`,
              `${section}.${key}.ui.pin.integrity`,
            ],
          }),
      urlField: `${section}.${key}.ui.production`,
    },
  ];
  if (name) {
    entries.push({
      url: base,
      urlField: `${section}.${key}.ui.production`,
      value: name,
      valueField: `${section}.${key}.ui.name`,
    });
  }
  entries.push({
    url: `${base}ssr/`,
    integrity: ssrIntegrity,
    urlField: `${section}.${key}.ui.ssr`,
    integrityField: `${section}.${key}.ui.ssrIntegrity`,
  });
  return entries;
}
