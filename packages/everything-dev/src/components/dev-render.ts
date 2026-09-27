import chalk from "chalk";
import { stripAnsi } from "../dev-log-pipeline";
import { linkify } from "../utils/linkify";
import { colors, divider, frames, gradients, icons } from "../utils/theme";

const PLUGIN_PREFIX = "plugin:";
const VIEW_WIDTH = 52;
const LOG_TAIL = 12;

export type DevProcessStatus = "pending" | "starting" | "ready" | "error";

export interface DevProcessState {
  name: string;
  status: DevProcessStatus;
  port: number;
  message?: string;
  source?: string;
  uiPort?: number;
}

export interface DevLogLine {
  source: string;
  line: string;
  isError?: boolean;
}

export interface DevSessionState {
  description: string;
  proxyTarget?: string;
  processes: DevProcessState[];
  logs: DevLogLine[];
}

export interface DevRendererHandle {
  updateProcess: (name: string, status: DevProcessStatus, message?: string) => void;
  addLog: (source: string, line: string, isError?: boolean) => void;
  unmount: () => void;
}

export interface DevRendererOutput {
  write: (text: string) => void;
}

interface DevRendererInput {
  setRawMode?: (mode: boolean) => void;
  resume?: () => void;
  pause?: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

export const getDisplayName = (name: string): string =>
  name.startsWith(PLUGIN_PREFIX)
    ? name.slice(PLUGIN_PREFIX.length).toUpperCase()
    : name.toUpperCase();

const isPlugin = (name: string): boolean => name.startsWith(PLUGIN_PREFIX);

const CORE_SERVICES = new Set(["host", "api", "ui"]);

const UI_PREFIX = "plugin-ui:";

export interface MergedProcess extends DevProcessState {
  ui?: DevProcessState;
}

const STATUS_RANK: Record<DevProcessStatus, number> = {
  ready: 0,
  pending: 1,
  starting: 2,
  error: 3,
};

const worstStatus = (a: DevProcessStatus, b: DevProcessStatus): DevProcessStatus =>
  STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;

/**
 * One row per plugin: `plugin-ui:<id>` companions merge into their parent
 * (`plugin:<id>`, or the `auth` app slot for the auth mirror) as an inline
 * ui-port annotation. Orphan ui rows (no parent process) render as-is.
 * Folder-form plugin UIs never get a companion service — their UI build is a
 * child of the parent's dev process — so their `uiPort` synthesizes the same
 * annotation.
 */
export const mergePluginUiRows = (processes: DevProcessState[]): MergedProcess[] => {
  const byName = new Map(processes.map((p) => [p.name, p]));
  const consumed = new Set<string>();
  const merged: MergedProcess[] = [];

  for (const proc of processes) {
    if (proc.name.startsWith(UI_PREFIX)) continue;
    const row: MergedProcess = { ...proc };
    const pluginId = isPlugin(proc.name) ? proc.name.slice(PLUGIN_PREFIX.length) : proc.name;
    const ui = byName.get(`${UI_PREFIX}${pluginId}`);
    if (ui) {
      row.ui = ui;
      row.status = worstStatus(proc.status, ui.status);
      consumed.add(ui.name);
    } else if (proc.uiPort && proc.uiPort > 0) {
      row.ui = { ...proc, port: proc.uiPort };
    }
    merged.push(row);
  }

  for (const proc of processes) {
    if (!consumed.has(proc.name) && proc.name.startsWith(UI_PREFIX)) merged.push({ ...proc });
  }
  return merged;
};

const getServiceColor = (name: string): ((text: string) => string) => {
  if (name === "host") return colors.cyan;
  if (name === "ui") return colors.magenta;
  if (CORE_SERVICES.has(name)) return colors.blue;
  return colors.orange;
};

const getStatusText = (proc: DevProcessState): string => {
  switch (proc.status) {
    case "pending":
      return "waiting";
    case "starting":
      return "starting";
    case "ready":
      return proc.source === "remote" && proc.name !== "host" ? "loaded" : "running";
    case "error":
      return "failed";
  }
};

const getStatusIcon = (status: DevProcessStatus): string => {
  switch (status) {
    case "pending":
      return colors.gray(icons.pending);
    case "starting":
      return colors.cyan(icons.scan);
    case "ready":
      return colors.green(icons.ok);
    case "error":
      return colors.error(icons.err);
  }
};

export const sectionProcesses = (
  processes: MergedProcess[],
): Array<{
  key: string;
  title: string;
  processes: MergedProcess[];
}> => {
  const plugins = processes.filter((p) => !CORE_SERVICES.has(p.name));
  const services = processes.filter((p) => CORE_SERVICES.has(p.name));
  const sections: Array<{ key: string; title: string; processes: MergedProcess[] }> = [];
  if (plugins.length > 0) sections.push({ key: "plugins", title: "PLUGINS", processes: plugins });
  if (services.length > 0)
    sections.push({ key: "services", title: "SERVICES", processes: services });
  return sections;
};

const getColumnWidths = (processes: MergedProcess[]): { name: number; source: number } => {
  const name = Math.max(6, ...processes.map((p) => getDisplayName(p.name).length));
  const source = Math.max(10, ...processes.map((p) => (p.source ? ` (${p.source})`.length : 0)));
  return { name, source };
};

export const renderProcessRow = (
  proc: MergedProcess,
  nameWidth: number,
  sourceWidth: number,
): string => {
  const color = getServiceColor(proc.name);
  const isRemote = proc.source === "remote";
  const isHost = proc.name === "host";
  const showPort = proc.port > 0 && (isHost || !isRemote);
  const portStr = showPort ? `:${proc.port}` : "";
  const sourceLabel = proc.source ? ` (${proc.source})` : "";
  const statusColor = proc.status === "ready" ? colors.green : colors.gray;
  const uiAnnotation = proc.ui && proc.ui.port > 0 ? colors.gray(` · ui :${proc.ui.port}`) : "";
  return `  ${getStatusIcon(proc.status)} ${chalk.bold(color(getDisplayName(proc.name).padEnd(nameWidth)))}${colors.gray(sourceLabel.padEnd(sourceWidth))} ${statusColor(getStatusText(proc))}${showPort ? colors.cyan(` ${portStr}`) : ""}${uiAnnotation}`;
};

export const renderLogLine = (entry: DevLogLine): string => {
  const color = getServiceColor(entry.source);
  return `${color(`[${entry.source}]`)} ${entry.isError ? colors.error(linkify(entry.line)) : linkify(entry.line)}`;
};

const truncateUrl = (url: string, maxLen: number): string => {
  if (url.length <= maxLen) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.host;
    if (host.length > maxLen - 10) return `${host.slice(0, maxLen - 13)}…`;
    return `${host}…`;
  } catch {
    return `${url.slice(0, maxLen - 3)}…`;
  }
};

const renderReadyBlock = (hostPort: number): string[] => [
  `  ${colors.green(icons.app)} APP READY`,
  `  ${chalk.bold(colors.green(icons.arrow))} http://localhost:${hostPort}`,
];

const renderProxyLine = (proxyTarget: string): string =>
  `  ${colors.orange(icons.arrow)} API PROXY → ${truncateUrl(proxyTarget, 38)}`;

const renderBanner = (description: string): string[] => [
  colors.cyan(frames.top(VIEW_WIDTH)),
  `  ${icons.run} ${gradients.cyber(description.toUpperCase())}`,
  colors.cyan(frames.bottom(VIEW_WIDTH)),
];

const getHostPort = (processes: DevProcessState[]): number =>
  processes.find((p) => p.name === "host")?.port || 3000;

export function renderDevLines(state: DevSessionState): string[] {
  const rows = mergePluginUiRows(state.processes);
  const lines: string[] = renderBanner(state.description);

  const allReady = rows.length > 0 && rows.every((p) => p.status === "ready");
  const hostPort = getHostPort(state.processes);

  if (allReady) {
    lines.push("");
    lines.push(...renderReadyBlock(hostPort));
  }

  if (state.proxyTarget) {
    lines.push("");
    lines.push(renderProxyLine(state.proxyTarget));
  }

  lines.push("");
  lines.push(colors.dim(divider(VIEW_WIDTH)));

  const widths = getColumnWidths(rows);
  for (const section of sectionProcesses(rows)) {
    lines.push(`  ${chalk.bold(colors.cyan(section.title))}`);
    for (const proc of section.processes) {
      lines.push(renderProcessRow(proc, widths.name, widths.source));
    }
  }

  lines.push(colors.dim(divider(VIEW_WIDTH)));
  lines.push(
    `  ${allReady ? colors.green(icons.ok) : colors.cyan(icons.scan)} ${
      allReady
        ? `All ${rows.length} services running`
        : `${rows.filter((p) => p.status === "ready").length}/${rows.length} ready`
    }${colors.gray(`   ${icons.dot} q quit ${icons.dot} l logs`)}`,
  );

  if (state.logs.length > 0) {
    lines.push(colors.dim(divider(VIEW_WIDTH)));
    for (const entry of state.logs.slice(-LOG_TAIL)) {
      lines.push(renderLogLine(entry));
    }
  }

  return lines;
}

export function renderDevState(state: DevSessionState): string {
  return `${renderDevLines(state).join("\n")}\n`;
}

export function createDevRenderer(
  initialProcesses: DevProcessState[],
  description: string,
  env: Record<string, string>,
  onExit?: () => Promise<void> | void,
  onExportLogs?: () => Promise<void> | void,
  options?: {
    output?: DevRendererOutput;
    stdin?: DevRendererInput;
    interactive?: boolean;
    onForceExit?: () => void;
  },
): DevRendererHandle {
  const output = options?.output ?? process.stdout;
  const stdinSource = (options?.stdin ?? process.stdin) as DevRendererInput & { isTTY?: boolean };
  const stdoutSource = output as DevRendererOutput & { isTTY?: boolean };
  const isInteractive =
    stdinSource.isTTY === true && stdoutSource.isTTY === true && options?.interactive !== false;

  const state: Omit<DevSessionState, "logs"> & { logs: Array<DevLogLine & { seq: number }> } = {
    description,
    proxyTarget: env.API_PROXY,
    processes: initialProcesses.map((p) => ({ ...p })),
    logs: [],
  };

  let nextLogSeq = 0;

  let lastLogKey: string | null = null;
  const listeners: Array<() => void> = [];

  let mounted = true;
  const stopListeners = () => {
    mounted = false;
    listeners.length = 0;
  };

  const setState = (mutate: () => void) => {
    if (!mounted) return;
    mutate();
    for (const listener of listeners) listener();
  };

  const handle: DevRendererHandle = {
    updateProcess: (name, status, message) =>
      setState(() => {
        state.processes = state.processes.map((p) =>
          p.name === name ? { ...p, status, message } : p,
        );
      }),
    addLog: (source, line, isError = false) =>
      setState(() => {
        const nextKey = `${source}:${isError ? "1" : "0"}:${line}`;
        if (nextKey === lastLogKey) return;
        lastLogKey = nextKey;
        state.logs = [...state.logs, { source, line, isError, seq: nextLogSeq++ }];
        if (state.logs.length > 100) state.logs = state.logs.slice(-100);
      }),
    unmount: () => {
      stopListeners();
    },
  };

  if (!isInteractive) {
    let readyPrinted = false;
    let printedLogSeq = -1;
    const printedRows = new Map<string, string>();

    const rowKey = (row: MergedProcess): string => `${row.status}:${row.ui?.port ?? ""}`;

    const printHeader = () => {
      const rows = mergePluginUiRows(state.processes);
      const widths = getColumnWidths(rows);
      const lines = ["", ...renderBanner(description)];
      if (state.proxyTarget) {
        lines.push(renderProxyLine(state.proxyTarget));
      }
      lines.push("");
      for (const section of sectionProcesses(rows)) {
        lines.push(`  ${chalk.bold(colors.cyan(section.title))}`);
        for (const proc of section.processes) {
          lines.push(renderProcessRow(proc, widths.name, widths.source));
          printedRows.set(proc.name, rowKey(proc));
        }
      }
      lines.push("");
      output.write(`${lines.join("\n")}\n`);
    };

    const printChanges = () => {
      const rows = mergePluginUiRows(state.processes);
      const widths = getColumnWidths(rows);
      for (const row of rows) {
        if (printedRows.get(row.name) !== rowKey(row)) {
          printedRows.set(row.name, rowKey(row));
          output.write(`${renderProcessRow(row, widths.name, widths.source)}\n`);
        }
      }
      const ready = rows.length > 0 && rows.every((p) => p.status === "ready");
      if (ready && !readyPrinted) {
        readyPrinted = true;
        output.write(`\n${renderReadyBlock(getHostPort(state.processes)).join("\n")}\n\n`);
      }
      for (const log of state.logs) {
        if (log.seq <= printedLogSeq) continue;
        output.write(`${renderLogLine(log)}\n`);
        printedLogSeq = log.seq;
      }
    };

    printHeader();
    listeners.push(printChanges);

    return handle;
  }

  output.write("\x1b[?1049h\x1b[?25l");

  const ttyOutput = output as DevRendererOutput & {
    rows?: number;
    columns?: number;
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  };

  const viewportRows = (): number => Math.max(4, ttyOutput.rows ?? 24);
  const viewportCols = (): number => Math.max(20, ttyOutput.columns ?? 80);

  const clipLine = (line: string, cols: number): string => {
    const visible = stripAnsi(line);
    if (visible.length <= cols) return line;
    let consumed = 0;
    let cut = line.length;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === "\x1b") {
        const next = line[i + 1];
        if (next === "[") {
          i += 2;
          while (i < line.length && !(line.charCodeAt(i) >= 64 && line.charCodeAt(i) <= 126)) i++;
          i++;
          continue;
        }
        if (next === "]") {
          const bel = line.indexOf("\x07", i + 2);
          i = bel === -1 ? line.length : bel + 1;
          continue;
        }
        i += 2;
        continue;
      }
      consumed++;
      if (consumed > cols - 1) {
        cut = i;
        break;
      }
      i++;
    }
    return `${line.slice(0, cut)}…`;
  };

  const repaint = () => {
    const maxRows = viewportRows() - 1;
    const lines = renderDevLines(state).slice(0, maxRows);
    const cols = viewportCols();
    const frame = lines.map((line) => `${clipLine(line, cols)}\x1b[K`).join("\n");
    output.write(`\x1b[H${frame}\x1b[J`);
  };

  repaint();

  listeners.push(repaint);

  const onResize = () => repaint();
  ttyOutput.on?.("resize", onResize);

  const stdin = stdinSource;
  const rawCapable = stdin as DevRendererInput & { setRawMode?: (mode: boolean) => void };

  let quitCount = 0;
  const onKey = (...args: unknown[]) => {
    const data = args[0] as Buffer;
    const key = data.toString();
    if (key === "l") {
      void Promise.resolve(onExportLogs?.());
      return;
    }
    if (key === "q" || key === "\x03") {
      quitCount++;
      if (quitCount > 1) {
        void Promise.resolve(options?.onForceExit?.());
        return;
      }
      void Promise.resolve(onExit?.());
    }
  };

  try {
    rawCapable.setRawMode?.(true);
    // Bun's TTY stdin never enters flowing mode from a bare `data` listener
    // attach, so q/Ctrl-C bytes would never arrive while ISIG is off — the
    // session would be unquittable from its own terminal. resume() starts the
    // stream (a no-op if already flowing).
    rawCapable.resume?.();
  } catch {
    // raw mode unavailable: key handling is inert; shutdown stays reachable via SIGTERM and bos kill
  }
  rawCapable.on("data", onKey);

  let restored = false;
  handle.unmount = () => {
    stopListeners();
    if (restored) return;
    restored = true;
    rawCapable.removeListener("data", onKey);
    ttyOutput.removeListener?.("resize", onResize);
    rawCapable.setRawMode?.(false);
    rawCapable.pause?.();
    output.write("\x1b[?25h\x1b[?1049l");
  };

  return handle;
}
