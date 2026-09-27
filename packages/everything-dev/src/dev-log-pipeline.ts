const ESC = "\x1b";
const BEL = "\x07";
const ANSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*${BEL}`, "g");

export const stripAnsi = (input: string): string => input.replace(ANSI_RE, "");

export type LogLevel = "error" | "warn" | "info" | "debug";

export type LogCategory = "banner" | "build" | "db" | "mf" | "lifecycle" | "shutdown" | "other";

export interface RawLogLine {
  source: string;
  line: string;
  isError?: boolean;
  timestamp?: number;
}

export interface LogEvent {
  timestamp: number;
  source: string;
  line: string;
  isError: boolean;
  level: LogLevel;
  category: LogCategory;
}

const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

export interface LogLevelEnv {
  BOS_LOG_LEVEL?: string;
  DEBUG?: string;
}

export function resolveLogLevel(
  env: LogLevelEnv = process.env as LogLevelEnv,
  flag?: string,
): LogLevel {
  if (flag && (LOG_LEVELS as readonly string[]).includes(flag)) return flag as LogLevel;
  if (env.BOS_LOG_LEVEL && (LOG_LEVELS as readonly string[]).includes(env.BOS_LOG_LEVEL)) {
    return env.BOS_LOG_LEVEL as LogLevel;
  }
  if (env.DEBUG === "true" || env.DEBUG === "1") return "debug";
  return "warn";
}

const STACK_FRAME_RE = /^\s+at\s/;

const countBraces = (line: string): number => {
  let count = 0;
  for (const ch of line) {
    if (ch === "{") count += 1;
    else if (ch === "}") count -= 1;
  }
  return count;
};

interface PendingMeta {
  source: string;
  isError?: boolean;
  timestamp?: number;
}

interface NormalizerState {
  pending: string[];
  openBraces: number;
  meta?: PendingMeta;
}

const makeNormalizerState = (): NormalizerState => ({ pending: [], openBraces: 0 });

const pushLine = (state: NormalizerState, line: string) => {
  state.pending.push(line);
  state.openBraces = Math.max(0, state.openBraces + countBraces(line));
};

const resetState = (state: NormalizerState) => {
  state.pending = [];
  state.openBraces = 0;
};

interface CompletedEvent {
  text: string;
  meta: PendingMeta;
}

const feedLine = (
  state: NormalizerState,
  line: string,
  meta: PendingMeta,
): CompletedEvent | null => {
  if (state.pending.length === 0) {
    state.meta = meta;
    pushLine(state, line);
    return null;
  }

  const isContinuation = state.openBraces > 0 || STACK_FRAME_RE.test(line) || /^\s*\{/.test(line);

  if (isContinuation) {
    const closeOnBalance = state.openBraces > 0;
    pushLine(state, line);
    if (closeOnBalance && state.openBraces === 0) {
      const completed = { text: state.pending.join("\n"), meta: state.meta! };
      resetState(state);
      return completed;
    }
    return null;
  }

  const completed = { text: state.pending.join("\n"), meta: state.meta! };
  resetState(state);
  state.meta = meta;
  pushLine(state, line);
  return completed;
};

const drainState = (state: NormalizerState): CompletedEvent | null => {
  if (state.pending.length === 0) return null;
  const completed = { text: state.pending.join("\n"), meta: state.meta! };
  resetState(state);
  return completed;
};

export function normalizeLines(lines: string[]): string[] {
  const state = makeNormalizerState();
  const events: string[] = [];
  for (const line of lines) {
    const completed = feedLine(state, line, { source: "" });
    if (completed !== null) events.push(completed.text);
  }
  const last = drainState(state);
  if (last !== null) events.push(last.text);
  return events;
}

const WARN_RE = /(?:^|\s)WARN\b|\[WARN\]|(?:^|\s)\w*Warning:/i;
const DEBUG_RE = /(?:^|\s)DEBUG\b|\[DEBUG\]/i;

const EXIT_LINE_RE =
  /^Process exited (?:after|before) ready \((?:exit code: (\d+)|signal: ([A-Z]+))\)/;

const CLEAN_SIGNALS = new Set(["SIGTERM", "SIGINT"]);

const CATEGORY_PATTERNS: Array<{ category: LogCategory; patterns: RegExp[] }> = [
  {
    category: "shutdown",
    patterns: [EXIT_LINE_RE, /\[SIGTERM\]/i, /shutting down/i, /graceful shutdown/i],
  },
  {
    category: "mf",
    patterns: [
      /\[ ?Federation Runtime ?\]/,
      /\[MF\]/,
      /Module Federation/i,
      /Executing an Effect versioned/,
      /you may want to dedupe the effect dependencies/,
      /\[IntegrityMonitor\]/,
      /\[Plugins\]/,
    ],
  },
  {
    category: "db",
    patterns: [/\[Database\]/i, /\bpostgres\b/i, /\bdrizzle\b/i, /\bpglite\b/i],
  },
  {
    category: "banner",
    patterns: [/🚀|📡|📖|💚/, /➜/, /^[┌┐└┘│─┬┴├┤╔╗╚╝║═]/],
  },
  {
    category: "build",
    patterns: [
      /rspack\.config\.js not found/,
      /rspack|rsbuild/i,
      /compiled (?:success|with|in)/i,
      /built in \d+/i,
      /webpack/i,
      /\bHMR\b/,
      /building for production/i,
    ],
  },
  {
    category: "lifecycle",
    patterns: [/\bready in\b/i, /listening (?:on|at)/i, /server (?:is )?running/i],
  },
];

const classifyCategory = (text: string): LogCategory => {
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) return category;
  }
  return "other";
};

export function classifyEvent(raw: RawLogLine): LogEvent {
  const text = stripAnsi(raw.line);
  const exitMatch = text.match(EXIT_LINE_RE);
  const category = classifyCategory(text);

  let level: LogLevel;
  let isError = raw.isError === true;

  if (exitMatch) {
    if (exitMatch[2]) {
      level = CLEAN_SIGNALS.has(exitMatch[2]) ? "info" : "error";
    } else {
      level = exitMatch[1] === "0" ? "info" : "error";
    }
    isError = level === "error";
  } else if (WARN_RE.test(text)) {
    level = "warn";
    isError = false;
  } else if (DEBUG_RE.test(text)) {
    level = "debug";
    isError = false;
  } else if (isError) {
    level = "error";
  } else {
    level = "info";
  }

  return {
    timestamp: raw.timestamp ?? Date.now(),
    source: raw.source,
    line: text,
    isError,
    level,
    category,
  };
}

export function passesLevel(event: LogEvent, level: LogLevel): boolean {
  return LEVEL_RANK[event.level] <= LEVEL_RANK[level];
}

export interface CollapsedDbEvent extends LogEvent {
  collapsed: boolean;
}

class DbCollapser {
  private runs = new Set<string>();

  feed(event: LogEvent): CollapsedDbEvent | null {
    if (event.category === "db" && event.level !== "error") {
      if (!this.runs.has(event.source)) {
        this.runs.add(event.source);
        return { ...event, line: "db ready", isError: false, level: "info", collapsed: true };
      }
      return null;
    }
    this.runs.delete(event.source);
    return { ...event, collapsed: false };
  }
}

export interface LogPipelineSinks {
  display: (event: LogEvent) => void;
  file: (event: LogEvent) => void;
  export: (event: LogEvent) => void;
}

export interface LogPipeline {
  ingest: (raw: RawLogLine) => void;
  flush: () => void;
}

export function createLogPipeline(options: {
  level?: LogLevel;
  sinks: LogPipelineSinks;
}): LogPipeline {
  const level = options.level ?? resolveLogLevel();
  const sinks = options.sinks;
  const normalizers = new Map<string, NormalizerState>();
  const collapser = new DbCollapser();

  const stateFor = (source: string): NormalizerState => {
    let state = normalizers.get(source);
    if (!state) {
      state = makeNormalizerState();
      normalizers.set(source, state);
    }
    return state;
  };

  const emit = (meta: PendingMeta, text: string) => {
    const event = classifyEvent({
      source: meta.source,
      line: text,
      isError: meta.isError,
      timestamp: meta.timestamp,
    });
    sinks.file(event);
    if (!passesLevel(event, level)) return;
    const collapsed = collapser.feed(event);
    if (!collapsed) return;
    sinks.export(collapsed);
    sinks.display(collapsed);
  };

  return {
    ingest: (raw) => {
      const clean = stripAnsi(raw.line);
      if (!clean.trim()) return;
      const state = stateFor(raw.source);
      const completed = feedLine(state, clean, {
        source: raw.source,
        isError: raw.isError,
        timestamp: raw.timestamp,
      });
      if (completed !== null) emit(completed.meta, completed.text);
    },
    flush: () => {
      for (const state of normalizers.values()) {
        const completed = drainState(state);
        if (completed !== null) emit(completed.meta, completed.text);
      }
    },
  };
}
