import { existsSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { findConfigPath, MISSING_CONFIG_MESSAGE } from "../../config";
import type {
  KillOptions,
  KillResult,
  LogsOptions,
  LogsResult,
  PsResult,
  TypecheckWorkspaceResult,
} from "../../contract";
import { colors, frames, gradients, icons } from "../../utils/theme";
import { exitCodeFor } from "../exit-codes";
import { printConfigView } from "../render/config";
import { formatTimeAgo } from "../render/logs";
import { renderPs } from "../render/processes";
import { compareSemver } from "../status";
import type { ResultRenderer } from "./context";

export const inspectRenderers: Record<string, ResultRenderer> = {
  config: async (result, _ctx) => {
    if (!result.config) {
      console.error(MISSING_CONFIG_MESSAGE);
      process.exit(1);
    }

    printConfigView(result.config);
    process.stdout.write(`${JSON.stringify(result.config, null, 2)}\n`);
    return;
  },

  status: async (result, _ctx) => {
    console.log();
    if (exitCodeFor(result) === 1) {
      console.error(`[CLI] ${result.error || "Unknown error"}`);
      process.exit(1);
    }
    console.log(colors.cyan(frames.top(52)));
    console.log(`  ${icons.app} ${gradients.cyber("STATUS")}`);
    console.log(colors.cyan(frames.bottom(52)));
    console.log();
    if (result.extends) console.log(`  ${colors.dim("Extends:")}     ${result.extends}`);
    if (result.account) console.log(`  ${colors.dim("Account:")}     ${result.account}`);
    if (result.domain) console.log(`  ${colors.dim("Domain:")}      ${result.domain}`);
    console.log();
    console.log(`  ${colors.dim("Packages:")}`);
    for (const pkg of result.packages) {
      const hasUpdate = pkg.installed && pkg.latest && compareSemver(pkg.installed, pkg.latest) < 0;
      const versionStr = hasUpdate
        ? `${pkg.installed}  →  ${pkg.latest}`
        : pkg.installed || "not installed";
      const label = hasUpdate ? colors.yellow(versionStr) : colors.dim(versionStr);
      console.log(`    ${colors.dim(`${pkg.name}`)}  ${label}`);
    }
    console.log();
    if (result.lastSync) {
      const ago = formatTimeAgo(result.lastSync);
      console.log(`  ${colors.dim("Last sync:")}   ${ago}`);
    } else {
      console.log(`  ${colors.dim("Last sync:")}   never`);
    }
    const envLabel =
      result.envFile === "found"
        ? colors.green("found")
        : result.envFile === "example-only"
          ? colors.yellow("missing (only .env.example found)")
          : colors.error("missing");
    console.log(`  ${colors.dim(".env:")}         ${envLabel}`);
    if (result.parentReachable !== undefined) {
      const parentLabel = result.parentReachable
        ? colors.green("reachable")
        : colors.error("unreachable");
      console.log(`  ${colors.dim("Parent:")}      ${parentLabel}`);
    }
    const hasUpdates = result.packages.some(
      (p: { installed?: string; latest?: string }) =>
        p.installed && p.latest && compareSemver(p.installed, p.latest) < 0,
    );
    if (hasUpdates) {
      console.log();
      console.log(
        colors.dim(
          `  Run ${colors.cyan("bos upgrade")} to update packages and sync template files.`,
        ),
      );
    }
    console.log();
    return;
  },

  ps: async (result, _ctx) => {
    renderPs(result as PsResult);
    return;
  },

  logs: async (result, ctx) => {
    const input = ctx.input;
    const logsResult = result as LogsResult;
    const opts = input as LogsOptions;
    for (const line of logsResult.lines) {
      console.log(line);
    }
    if (logsResult.lines.length === 0) {
      console.log(colors.dim(`  No matching log lines in ${logsResult.logFile}.`));
    }
    if (opts.follow) {
      if (logsResult.logFile === "unknown" || !existsSync(logsResult.logFile)) {
        console.log(colors.dim("  No log file to follow — nothing was found on disk."));
      } else {
        const filter = opts.service;
        let byteOffset = 0;
        for (const line of logsResult.lines) byteOffset += Buffer.byteLength(line, "utf8") + 1;
        const followMatch = (line: string): boolean => {
          if (!filter) return true;
          const source = /\] \[([^\]]+)\] \[(?:OUT|ERR)\] /.exec(line)?.[1];
          return source === filter || source === `plugin:${filter}`;
        };
        const watcher = watch(logsResult.logFile, (event) => {
          if (event !== "change") return;
          void readFile(logsResult.logFile, "utf8")
            .then((text) => {
              const newLines = text
                .slice(byteOffset)
                .split("\n")
                .filter((line) => line.length > 0 && followMatch(line));
              byteOffset = Buffer.byteLength(text, "utf8");
              for (const line of newLines) {
                console.log(line);
              }
            })
            .catch(() => {
              // the followed file was rotated or deleted — stop following
              watcher.close();
            });
        });
        console.log(colors.dim("  Following — Ctrl+C to stop."));
        process.on("SIGINT", () => {
          watcher.close();
          process.exit(0);
        });
      }
    }
    return;
  },

  kill: async (result, ctx) => {
    const input = ctx.input;
    const killResult = result as KillResult;
    console.log();
    if (killResult.status === "error") {
      console.error(`[CLI] ${killResult.error || "Unknown error"}`);
      process.exit(1);
    }
    if (killResult.killed.length > 0) {
      console.log(colors.green(`${icons.ok} Sent ${killResult.killed.length} kill signal(s)`));
      for (const k of killResult.killed) {
        console.log(`  ${colors.dim("pid")} ${k.pid}  ${colors.dim(k.configDir)}`);
      }
    }
    if (killResult.skipped.length > 0) {
      console.log(colors.yellow(`${icons.err} ${killResult.skipped.length} skipped`));
      for (const s of killResult.skipped) {
        console.log(`  ${colors.dim("pid")} ${s.pid}  ${colors.dim(s.reason)}`);
      }
    }
    if (killResult.killed.length === 0 && killResult.skipped.length === 0) {
      const opts = input as KillOptions;
      if (opts.all) {
        console.log(colors.dim("  No tracked processes to kill."));
      } else {
        const configPath = findConfigPath();
        const dir = opts.configDir ?? (configPath ? resolve(dirname(configPath)) : process.cwd());
        console.log(colors.dim(`  No tracked processes for ${dir}`));
        console.log(colors.dim(`  Use ${colors.cyan("--all")} to kill across all directories.`));
      }
    }
    console.log();
    return;
  },

  typesGen: async (result, _ctx) => {
    console.log();
    if (exitCodeFor(result) === 1) {
      console.error(`[CLI] ${result.error || "Unknown error"}`);
      process.exit(1);
    }
    console.log(colors.green(`${icons.ok} Types generated`));
    if (result.generated.length > 0) {
      console.log(`  ${colors.dim("Written:")}`);
      for (const f of result.generated) console.log(`    ${colors.dim(f)}`);
    }
    if (result.fetched.length > 0 || result.skipped.length > 0 || result.failed.length > 0) {
      console.log(`  ${colors.dim("Contract sources:")}`);
      for (const entry of result.fetched) {
        const space = entry.indexOf(" ");
        const key = space !== -1 ? entry.slice(0, space) : entry;
        const rest = space !== -1 ? entry.slice(space + 1) : "";
        const restSpace = rest.indexOf(" ");
        const detail = restSpace !== -1 ? rest.slice(restSpace + 1) : "";
        console.log(`    ${key} ${colors.cyan("remote")}${detail ? ` ${colors.dim(detail)}` : ""}`);
      }
      for (const entry of result.skipped) {
        const space = entry.indexOf(" ");
        const key = space !== -1 ? entry.slice(0, space) : entry;
        const rest = space !== -1 ? entry.slice(space + 1) : "";
        if (rest === "no URL resolved") {
          console.log(`    ${key} ${colors.dim("no URL resolved")}`);
          continue;
        }
        const restSpace = rest.indexOf(" ");
        const detail = restSpace !== -1 ? rest.slice(restSpace + 1) : "";
        console.log(`    ${key} ${colors.dim("local")}${detail ? ` ${colors.dim(detail)}` : ""}`);
      }
    }
    if (result.failed.length > 0) {
      console.log(`  ${colors.yellow("Failed:")}`);
      for (const f of result.failed) {
        const colon = f.indexOf(": ");
        if (colon !== -1) {
          console.log(`    ${colors.error(f.slice(0, colon))}${colors.dim(f.slice(colon))}`);
        } else {
          console.log(`    ${colors.error(f)}`);
        }
      }
    }
    console.log();
    return;
  },

  typecheck: async (result, _ctx) => {
    console.log();
    if (exitCodeFor(result) === 1) {
      console.error(`[CLI] ${result.error || "Unknown error"}`);
      process.exit(1);
    }
    const failed = result.results.filter((r: TypecheckWorkspaceResult) => !r.passed);
    const passed = result.results.filter((r: TypecheckWorkspaceResult) => r.passed);
    console.log(colors.cyan(frames.top(52)));
    console.log(`  ${icons.app} ${gradients.cyber("TYPECHECK")}`);
    console.log(colors.cyan(frames.bottom(52)));
    console.log();
    for (const r of result.results) {
      const icon = r.passed ? colors.green("✓") : colors.error("✗");
      console.log(`  ${icon} ${r.workspace}`);
    }
    if (result.skipped.length > 0) {
      console.log(`  ${colors.dim(`Skipped: ${result.skipped.join(", ")}`)}`);
    }
    console.log();
    if (failed.length > 0) {
      console.log(`  ${colors.error(`${failed.length} failed`)}`);
      for (const f of failed) {
        if (f.error) console.log(`    ${colors.dim(f.error)}`);
      }
      console.log();
      process.exit(1);
    }
    console.log(`  ${colors.green(`${passed.length} passed`)}`);
    console.log();
    return;
  },

  mfCheck: async (result, _ctx) => {
    console.log();
    console.log(
      `  ${colors.dim("Host")}   ${result.hostReachable ? colors.green("OK  ") : colors.error("FAIL")}  ${
        result.hostVersion ?? "unreachable"
      }${result.hostReason ? `  (${result.hostReason})` : ""}`,
    );
    for (const r of result.remotes) {
      const tag = r.ok ? colors.green("OK  ") : colors.error("FAIL");
      console.log(
        `  ${colors.dim(r.role.padEnd(10))} ${tag} ${r.url}  pluginVersion=${r.pluginVersion ?? "?"}${
          r.reason ? `  ↳ ${r.reason}` : ""
        }`,
      );
    }
    if (result.platform) {
      for (const v of result.platform.violations) {
        console.log(`  ${colors.dim("platform".padEnd(10))} ${colors.error("FAIL")} ${v.message}`);
      }
      if (result.platform.ok) {
        console.log(
          `  ${colors.dim("platform".padEnd(10))} ${colors.green("OK  ")} release contract satisfied`,
        );
      }
    }
    console.log();
    if (result.status !== "ok") {
      console.log(
        colors.error(
          "  mf-compat: ✗ federation manifests NOT compatible — redeploy affected plugin(s) so pluginVersion and shared versions match host",
        ),
      );
      console.log();
      process.exit(1);
    }
    console.log(colors.green("  mf-compat: ✓ all federation manifests compatible"));
    console.log();
    return;
  },

  platformManifest: async (result, _ctx) => {
    console.log();
    if (result.status === "fail") {
      console.error(`[CLI] ${result.error || "platform manifest resolution failed"}`);
      process.exit(1);
    }
    if (result.status === "absent") {
      console.log(
        colors.yellow(
          `  ${icons.err} No platform release manifest resolves${result.error ? ` — ${result.error}` : ""}.`,
        ),
      );
      console.log(
        colors.dim("  Children fall back to the parent-repo tarball walk (ADR 0034 pt 7)."),
      );
      console.log();
      return;
    }
    console.log(
      `  ${colors.dim("Platform")}  ${colors.green(result.version ?? "?")}  ${colors.dim(`(${result.source}${result.fromCache ? ", cached" : ""})`)}`,
    );
    if (result.compat) {
      for (const v of result.compat.violations) {
        console.log(`  ${colors.error("FAIL")}  ${v.message}`);
      }
      console.log();
      if (!result.compat.ok) {
        console.log(
          colors.error(
            "  platform-compat: ✗ the workspace does not satisfy this release's compat contract — bump the framework or clear the pin",
          ),
        );
        console.log();
        process.exit(1);
      }
      console.log(colors.green("  platform-compat: ✓ workspace satisfies the release contract"));
    }
    console.log();
    return;
  },

  infraExport: async (result, _ctx) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  },
};
