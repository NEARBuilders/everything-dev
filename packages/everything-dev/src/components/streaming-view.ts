import chalk from "chalk";
import { linkify } from "../utils/linkify";
import { colors, icons } from "../utils/theme";
import type { ProcessState, ProcessStatus } from "./dev-view";

const orange = chalk.hex("#ffaa00");
const PLUGIN_PREFIX = "plugin:";

export interface StreamingViewHandle {
  updateProcess: (name: string, status: ProcessStatus, message?: string) => void;
  addLog: (source: string, line: string, isError?: boolean) => void;
  unmount: () => Promise<void> | void;
}

const getTimestamp = (): string => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
};

const write = (text: string) => process.stdout.write(`${text}\n`);

const getServiceColor = (name: string): ((s: string) => string) => {
  if (name.startsWith(PLUGIN_PREFIX)) return orange;
  if (name === "host") return colors.cyan;
  if (name === "ui" || name === "ui-ssr") return colors.magenta;
  if (name === "api") return colors.blue;
  return colors.white;
};

const getDisplayName = (name: string): string => {
  return name.startsWith(PLUGIN_PREFIX)
    ? name.slice(PLUGIN_PREFIX.length).toUpperCase()
    : name.toUpperCase();
};

const isPlugin = (name: string): boolean => name.startsWith(PLUGIN_PREFIX);

const getSectionedProcesses = (processes: ProcessState[]) => {
  const plugins = processes.filter((p) => isPlugin(p.name));
  const services = processes.filter((p) => !isPlugin(p.name));
  const sections: Array<{ key: string; title: string; processes: ProcessState[] }> = [];
  if (plugins.length > 0) sections.push({ key: "plugins", title: "PLUGINS", processes: plugins });
  if (services.length > 0)
    sections.push({ key: "services", title: "SERVICES", processes: services });
  return sections;
};

const getColumnWidths = (processes: ProcessState[]) => {
  const name = Math.max(6, ...processes.map((p) => getDisplayName(p.name).length));
  const source = Math.max(10, ...processes.map((p) => (p.source ? ` (${p.source})`.length : 0)));
  return { name, source };
};

const getStatusIcon = (status: ProcessStatus): string => {
  switch (status) {
    case "pending":
      return icons.pending;
    case "starting":
      return icons.scan;
    case "ready":
      return icons.ok;
    case "error":
      return icons.err;
  }
};

export function renderStreamingView(
  initialProcesses: ProcessState[],
  description: string,
  env: Record<string, string>,
  onExit?: () => Promise<void> | void,
): StreamingViewHandle {
  const processes = new Map<string, ProcessState>();
  for (const p of initialProcesses) {
    processes.set(p.name, { ...p });
  }

  let allReadyPrinted = false;
  const hostProcess = initialProcesses.find((p) => p.name === "host");
  const hostPort = hostProcess?.port || 3000;
  const proxyTarget = env.API_PROXY;
  const sectionedProcesses = getSectionedProcesses(initialProcesses);
  const columnWidths = getColumnWidths(initialProcesses);
  const lastLogBySource = new Map<string, string>();

  console.log();
  console.log(colors.cyan(`${"─".repeat(52)}`));
  console.log(`  ${icons.run} ${colors.cyan(description.toUpperCase())}`);
  console.log(colors.cyan(`${"─".repeat(52)}`));
  console.log();

  if (proxyTarget) {
    console.log(orange(`  ${icons.arrow} API PROXY → ${proxyTarget}`));
    console.log();
  }

  for (const section of sectionedProcesses) {
    console.log(colors.cyan(`  ${section.title}`));
    for (const proc of section.processes) {
      const color = getServiceColor(proc.name);
      const sourceLabel = proc.source ? ` (${proc.source})` : "";
      console.log(
        `${colors.dim(`[${getTimestamp()}]`)} ${color(`[${getDisplayName(proc.name).padEnd(columnWidths.name)}]`)}  ${icons.pending} waiting${sourceLabel.padEnd(columnWidths.source)}`,
      );
    }
    console.log();
  }

  const checkAllReady = () => {
    if (allReadyPrinted) return;
    const allReady = Array.from(processes.values()).every((p) => p.status === "ready");
    if (allReady) {
      allReadyPrinted = true;
      console.log();
      console.log(colors.dim(`${"─".repeat(52)}`));
      console.log(colors.green(`${icons.ok} All ${processes.size} services ready`));
      console.log(colors.green(`${icons.arrow} http://localhost:${hostPort}`));
      console.log(colors.dim(`${"─".repeat(52)}`));
      console.log();
    }
  };

  const updateProcess = (name: string, status: ProcessStatus, message?: string) => {
    const proc = processes.get(name);
    if (!proc) return;

    proc.status = status;
    if (message) proc.message = message;

    const color = getServiceColor(name);
    const icon = getStatusIcon(status);
    const displayName = getDisplayName(name).padEnd(columnWidths.name);
    const sourceLabel = proc?.source ? ` (${proc.source})` : "";
    const statusText =
      status === "ready"
        ? "ready"
        : status === "starting"
          ? "starting"
          : status === "error"
            ? "failed"
            : "waiting";
    const portStr = proc.port > 0 && status === "ready" ? ` :${proc.port}` : "";

    write(
      `${colors.dim(`[${getTimestamp()}]`)} ${color(`[${displayName}]`)}  ${status === "ready" ? colors.green(icon) : status === "error" ? colors.error(icon) : icon} ${statusText}${sourceLabel.padEnd(columnWidths.source)}${portStr}`,
    );

    checkAllReady();
  };

  const addLog = (source: string, line: string, isError = false) => {
    const lastLine = lastLogBySource.get(source);
    const nextLine = `${isError ? "ERR" : "OUT"}:${line}`;
    if (lastLine === nextLine) return;
    lastLogBySource.set(source, nextLine);

    const color = getServiceColor(source);
    const logColor = isError ? colors.error : colors.dim;
    write(
      `${colors.dim(`[${getTimestamp()}]`)} ${color(`[${source.toUpperCase()}]`)}  ${colors.dim("│")} ${logColor(linkify(line))}`,
    );
  };

  const unmount = () => onExit?.();

  let signalCount = 0;
  const forceExit = () => {
    console.log("\n[CLI] Force exit");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    signalCount++;
    if (signalCount > 1) {
      forceExit();
      return;
    }
    console.log();
    console.log(colors.dim(`[${getTimestamp()}] Shutting down...`));
    const timeout = setTimeout(forceExit, 5000);
    Promise.resolve(unmount()).then(() => {
      clearTimeout(timeout);
    });
  });

  return { updateProcess, addLog, unmount };
}
