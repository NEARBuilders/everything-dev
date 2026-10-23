import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveLocalDevelopmentPath } from "../../config";
import type { BosConfig, RuntimeConfig } from "../../types";

export interface LocalPackage {
  readonly name: string;
  readonly dir: string;
}

export function detectLocalPackages(
  bosConfig?: BosConfig,
  runtimeConfig?: RuntimeConfig,
  root: string = process.cwd(),
): LocalPackage[] {
  const packages: LocalPackage[] = [];
  const configDir = root;

  const uiLocalPath =
    runtimeConfig?.ui.localPath ??
    resolveLocalDevelopmentPath(bosConfig?.app.ui.development, configDir);
  if (uiLocalPath && existsSync(join(uiLocalPath, "package.json"))) {
    packages.push({ name: "ui", dir: uiLocalPath });
  }

  const apiLocalPath =
    runtimeConfig?.api.localPath ??
    resolveLocalDevelopmentPath(bosConfig?.app.api.development, configDir);
  if (apiLocalPath && existsSync(join(apiLocalPath, "package.json"))) {
    packages.push({ name: "api", dir: apiLocalPath });
  }

  const hostLocalPath =
    runtimeConfig?.host?.localPath ??
    resolveLocalDevelopmentPath(bosConfig?.app.host.development, configDir);
  if (hostLocalPath && existsSync(join(hostLocalPath, "package.json"))) {
    packages.push({ name: "host", dir: hostLocalPath });
  } else if (existsSync(join(configDir, "host", "package.json"))) {
    packages.push({ name: "host", dir: join(configDir, "host") });
  }

  for (const [pluginId, pluginConfig] of Object.entries(runtimeConfig?.plugins ?? {})) {
    if (pluginConfig.localPath && existsSync(join(pluginConfig.localPath, "package.json"))) {
      packages.push({ name: `plugin:${pluginId}`, dir: pluginConfig.localPath });
    }
    if (pluginConfig.ui?.localPath && existsSync(join(pluginConfig.ui.localPath, "package.json"))) {
      packages.push({ name: `plugin-ui:${pluginId}`, dir: pluginConfig.ui.localPath });
    }
  }

  const authLocalPath =
    runtimeConfig?.auth?.localPath ??
    resolveLocalDevelopmentPath(bosConfig?.app.auth?.development, configDir);
  if (authLocalPath && existsSync(join(authLocalPath, "package.json"))) {
    packages.push({ name: "auth", dir: authLocalPath });
  }

  return packages;
}
