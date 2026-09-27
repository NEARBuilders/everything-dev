import { execFile } from "node:child_process";
import { Effect } from "effect";

export interface PortOwner {
  pid: number;
  command: string;
}

export interface PortOwnershipOptions {
  lsofPath?: string;
  psPath?: string;
}

let lsofCached: boolean | null = null;

const execFileText = (path: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(path, args, { timeout: 5000 }, (error, stdout) => {
      if (error && !stdout) reject(error);
      else resolve(stdout);
    });
  });

const isValidPort = (port: number): boolean => Number.isInteger(port) && port > 0 && port <= 65535;

// ownerOfPort identifies the process listening on a port via lsof + ps.
// Returns null when the port is free or when lsof is unavailable (degraded:
// callers report "unknown owner" rather than failing).
export const ownerOfPort = (
  port: number,
  options?: PortOwnershipOptions,
): Effect.Effect<PortOwner | null> =>
  Effect.callback((resume) => {
    void (async () => {
      if (!isValidPort(port)) {
        resume(Effect.succeed(null));
        return;
      }
      const lsof = options?.lsofPath ?? "lsof";
      try {
        const stdout = await execFileText(lsof, ["-ti", `:${port}`, "-sTCP:LISTEN"]);
        const pid = Number.parseInt(stdout.trim().split("\n")[0] ?? "", 10);
        if (!Number.isInteger(pid) || pid <= 0) {
          resume(Effect.succeed(null));
          return;
        }
        try {
          const psOut = await execFileText(options?.psPath ?? "ps", [
            "-o",
            "command=",
            "-p",
            String(pid),
          ]);
          resume(Effect.succeed({ pid, command: psOut.trim() || "unknown" }));
        } catch {
          resume(Effect.succeed({ pid, command: "unknown" }));
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") lsofCached = false;
        resume(Effect.succeed(null));
      }
    })();
  });

// isLsofAvailable probes (once per process) whether the lsof binary exists —
// ownership reporting degrades gracefully when it does not.
export const isLsofAvailable = (options?: PortOwnershipOptions): Effect.Effect<boolean> =>
  Effect.callback((resume) => {
    if (lsofCached !== null) {
      resume(Effect.succeed(lsofCached));
      return;
    }
    void (async () => {
      try {
        await execFileText(options?.lsofPath ?? "lsof", ["-v"]);
        lsofCached = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") lsofCached = false;
        else lsofCached = true;
      }
      resume(Effect.succeed(lsofCached));
    })();
  });

export const resetLsofCacheForTests = (): void => {
  lsofCached = null;
};
