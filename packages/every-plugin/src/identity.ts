/**
 * Plugin identity: every name a plugin workspace carries, derived from one
 * input. Two seams live here:
 *
 * - `remoteName`/`containerName` absorb the framework's two normalizers (the
 *   Module Federation remote name and the UI container name) — runtime,
 *   build, and host consumers delegate to these instead of keeping private
 *   copies, so a name can never disagree across contexts.
 * - `identity` derives the full name set from the config layout key (the
 *   `plugins/<key>` attachment in `bos.config.json`): the key itself (the
 *   composition key), the npm package name under the scaffold convention,
 *   and the two normalized build names.
 *
 * Normalization rules:
 * - remote: lowercase, strip a single leading '@', replace '/' with '_',
 *   preserve hyphens and other characters
 *   ("@scope/my-plugin" → "scope_my-plugin")
 * - container: replace every character outside [A-Za-z0-9_] with '_'
 *   ("@everything-dev/auth-plugin" → "_everything_dev_auth_plugin")
 */
export interface PluginIdentity {
  key: string;
  npm: string;
  remote: string;
  container: string;
}

export const remoteName = (name: string): string =>
  name.toLowerCase().replace(/^@/, "").replace(/\//g, "_");

export const containerName = (pkgName: string): string => pkgName.replace(/[^A-Za-z0-9_]/g, "_");

export const identity = (key: string): PluginIdentity => {
  const npm = `@everything-dev/${key}-plugin`;
  return { key, npm, remote: remoteName(npm), container: containerName(npm) };
};
