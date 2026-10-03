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
   * bundle base) + its own SRI — written as the slot's `pin` */
  pin?: { file: string; integrity: string };
}): DeployResultEntry[] {
  const { origin, account, gateway, key, kind, integrity, ssrIntegrity, pin } = input;
  const slot = kind === "app" ? "app" : "plugins";
  const base = `${origin.replace(/\/$/, "")}/bundles/${account}/${gateway}/${key}/`;
  const entries: DeployResultEntry[] = [
    {
      url: base,
      ...(pin
        ? {
            value: pin.file,
            valueField: `${slot}.${key}.pin.manifest`,
            integrity: pin.integrity,
            integrityField: `${slot}.${key}.pin.integrity`,
            // the pinned slot's identity is the pin — a stale direct entry
            // SRI or retired flat manifest pointer must not linger
            removeFields: [`${slot}.${key}.integrity`, `${slot}.${key}.manifest`],
          }
        : {
            integrity,
            integrityField: `${slot}.${key}.integrity`,
            removeFields: [`${slot}.${key}.manifest`],
          }),
      urlField: `${slot}.${key}.production`,
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
 * bundle key (`<key>-ui`), pinning `<slot>.<key>.ui.*` in bos.config.json.
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
   * ui slot's `pin` */
  pin?: { file: string; integrity: string };
  /** The built MF container name — remote boots need it pinned in the config. */
  name?: string;
}): DeployResultEntry[] {
  const { origin, account, gateway, key, kind, integrity, ssrIntegrity, pin, name } = input;
  const slot = kind === "app" ? "app" : "plugins";
  const base = `${origin.replace(/\/$/, "")}/bundles/${account}/${gateway}/${key}-ui/`;
  const entries: DeployResultEntry[] = [
    {
      url: base,
      ...(pin
        ? {
            value: pin.file,
            valueField: `${slot}.${key}.ui.pin.manifest`,
            integrity: pin.integrity,
            integrityField: `${slot}.${key}.ui.pin.integrity`,
            removeFields: [`${slot}.${key}.ui.integrity`, `${slot}.${key}.ui.manifest`],
          }
        : {
            integrity,
            integrityField: `${slot}.${key}.ui.integrity`,
            removeFields: [`${slot}.${key}.ui.manifest`],
          }),
      urlField: `${slot}.${key}.ui.production`,
    },
  ];
  if (name) {
    entries.push({
      url: base,
      urlField: `${slot}.${key}.ui.production`,
      value: name,
      valueField: `${slot}.${key}.ui.name`,
    });
  }
  entries.push({
    url: `${base}ssr/`,
    integrity: ssrIntegrity,
    urlField: `${slot}.${key}.ui.ssr`,
    integrityField: `${slot}.${key}.ui.ssrIntegrity`,
  });
  return entries;
}
