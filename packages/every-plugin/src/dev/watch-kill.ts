interface KillableChild {
  pid?: number | undefined;
  kill: (signal?: NodeJS.Signals) => void;
  exitCode: number | null;
  killed: boolean;
  addListener: (event: "exit", listener: () => void) => unknown;
  removeListener: (event: "exit", listener: () => void) => unknown;
}

const waitForExit = (child: KillableChild, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(true);
      return;
    }
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.addListener("exit", onExit);
  });

export const killChildEscalating = async (
  child: KillableChild,
  terminateMs = 2000,
): Promise<void> => {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  const exited = await waitForExit(child, terminateMs);
  if (!exited) child.kill("SIGKILL");
};

export interface WatchParentDeathOptions {
  intervalMs?: number;
  getPpid?: () => number;
  onParentDeath?: () => void | Promise<void>;
}

export const watchParentDeath = (
  onParentDeath: () => void | Promise<void>,
  opts?: Omit<WatchParentDeathOptions, "onParentDeath">,
): { stop: () => void } => {
  const getPpid = opts?.getPpid ?? (() => process.ppid);
  const intervalMs = opts?.intervalMs ?? 200;
  const initialPpid = getPpid();
  const timer = setInterval(() => {
    if (getPpid() !== initialPpid) {
      clearInterval(timer);
      void onParentDeath();
    }
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
};
