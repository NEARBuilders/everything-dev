import { describe, expect, it } from "vitest";
import {
  classifyEvent,
  createLogPipeline,
  normalizeLines,
  type RawLogLine,
  resolveLogLevel,
  stripAnsi,
} from "../../src/dev-log-pipeline";

// Fixtures modeled on real `bos dev` session output: Effect Logger
// pretty-printed objects, Better Auth stdout warnings, dev-server banner
// blocks, rspack/rsbuild chatter, node ExperimentalWarning stack traces,
// and SIGTERM exit lines.
const EFFECT_LOGGER_OBJECT = [
  "[INFO] (api) Request context",
  "{",
  '  "method": "GET",',
  '  "path": "/api/health",',
  '  "status": 200',
  "}",
];

const EXPERIMENTAL_WARNING = [
  "(node:4242) ExperimentalWarning: The Fetch API is an experimental feature.",
  "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
  "    at Object.<anonymous> (/app/host/src/index.ts:3:1)",
];

const BETTER_AUTH_WARN_STDOUT = [
  "WARN [Better Auth]: No API key provided, skipping request",
  "WARN [Better Auth]: Session cookie missing, falling back to anonymous",
];

const DB_STARTUP = [
  "[Database] Initializing connection pool",
  "[Database] Applying migrations",
  "[Database] Migrations applied in 128ms",
];

const BANNER_BLOCK = [
  "🚀 📡 📖 💚",
  "➜ Local:   http://localhost:3003/",
  "➜ Network: http://192.168.1.4:3003/",
];

const RSPACK_CHATTER = [
  "rspack.config.js not found — using the every-plugin build composition",
  "Rspack compiled successfully in 2314 ms",
  "[ Federation Runtime ] Version 0.8.11 from ui of shared singleton module react",
];

const SHUTDOWN_LINES = [
  "Process exited after ready (exit code: 0)",
  "Process exited after ready (exit code: 1)",
  "[SIGTERM] Shutting down service",
];

const toRaw = (lines: string[], source = "api", isError = false): RawLogLine[] =>
  lines.map((line) => ({ source, line, isError }));

describe("stripAnsi", () => {
  it("strips SGR sequences and OSC titles", () => {
    expect(stripAnsi("\x1b[32mready\x1b[0m")).toBe("ready");
    expect(stripAnsi("\x1b]0;window title\x07done")).toBe("done");
    expect(stripAnsi("➜ Local:   http://localhost:3003/")).toBe(
      "➜ Local:   http://localhost:3003/",
    );
  });
});

describe("normalizeLines", () => {
  it("collapses Effect Logger multi-line objects into one event per logical log", () => {
    const events = normalizeLines(EFFECT_LOGGER_OBJECT);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("Request context");
    expect(events[0]).toContain('"path": "/api/health"');
    expect(events[0]).toContain("}");
  });

  it("collapses multi-line stack traces into a single event", () => {
    const events = normalizeLines(EXPERIMENTAL_WARNING);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("ExperimentalWarning");
    expect(events[0]).toContain("at process.processTicksAndRejections");
  });

  it("keeps ordinary lines as separate events", () => {
    const events = normalizeLines(["ready in 412 ms", "Listening on http://localhost:3001"]);
    expect(events).toEqual(["ready in 412 ms", "Listening on http://localhost:3001"]);
  });

  it("keeps each process's lines in its own events", () => {
    const events = normalizeLines(["[Database] Initializing connection pool"]);
    expect(events).toHaveLength(1);
  });
});

describe("classifyEvent", () => {
  it("classifies Better Auth WARN lines on stdout as warn", () => {
    for (const line of BETTER_AUTH_WARN_STDOUT) {
      const event = classifyEvent({ source: "api", line, isError: false });
      expect(event.level).toBe("warn");
    }
  });

  it("classifies stderr error-ish lines as error", () => {
    const event = classifyEvent({
      source: "host",
      line: "Error: connect ECONNREFUSED 127.0.0.1:5432",
      isError: true,
    });
    expect(event.level).toBe("error");
  });

  it("classifies dev-server banner blocks as banner", () => {
    for (const line of BANNER_BLOCK) {
      const event = classifyEvent({ source: "ui", line, isError: false });
      expect(event.category).toBe("banner");
      expect(event.level).not.toBe("error");
    }
    expect(classifyEvent({ source: "ui", line: "🚀 📡 📖 💚", isError: false }).category).toBe(
      "banner",
    );
  });

  it("classifies rspack/rsbuild and federation chatter as build/mf", () => {
    expect(
      classifyEvent({ source: "plugin:apps", line: RSPACK_CHATTER[0], isError: false }).category,
    ).toBe("build");
    expect(
      classifyEvent({ source: "plugin:apps", line: RSPACK_CHATTER[1], isError: false }).category,
    ).toBe("build");
    const mf = classifyEvent({ source: "host", line: RSPACK_CHATTER[2], isError: false });
    expect(mf.category).toBe("mf");
    expect(mf.level).not.toBe("error");
  });

  it("classifies [Database] startup lines as db info", () => {
    for (const line of DB_STARTUP) {
      const event = classifyEvent({ source: "api", line, isError: false });
      expect(event.category).toBe("db");
      expect(event.level).toBe("info");
    }
  });

  it("classifies clean exit (code 0) as shutdown info, not error", () => {
    const event = classifyEvent({ source: "api", line: SHUTDOWN_LINES[0], isError: true });
    expect(event.category).toBe("shutdown");
    expect(event.level).toBe("info");
    expect(event.isError).toBe(false);
  });

  it("keeps non-zero exits as errors", () => {
    const event = classifyEvent({ source: "api", line: SHUTDOWN_LINES[1], isError: true });
    expect(event.category).toBe("shutdown");
    expect(event.level).toBe("error");
    expect(event.isError).toBe(true);
  });

  it("classifies SIGTERM-signalled exits as shutdown info, not error", () => {
    const event = classifyEvent({
      source: "api",
      line: "Process exited after ready (signal: SIGTERM)",
      isError: true,
    });
    expect(event.category).toBe("shutdown");
    expect(event.level).toBe("info");
    expect(event.isError).toBe(false);
  });

  it("keeps crash signals as errors", () => {
    const event = classifyEvent({
      source: "api",
      line: "Process exited after ready (signal: SIGSEGV)",
      isError: true,
    });
    expect(event.category).toBe("shutdown");
    expect(event.level).toBe("error");
    expect(event.isError).toBe(true);
  });

  it("classifies shutdown signals as shutdown lifecycle", () => {
    const event = classifyEvent({ source: "host", line: SHUTDOWN_LINES[2], isError: false });
    expect(event.category).toBe("shutdown");
  });

  it("marks legacy noise patterns as mf info so level filtering can drop them", () => {
    const event = classifyEvent({
      source: "host",
      line: "Executing an Effect versioned 4.0.0-rc.112 with a Runtime of version 4.0.0-rc.100",
      isError: false,
    });
    expect(event.category).toBe("mf");
    expect(event.level).toBe("info");
  });

  it("classifies readiness lifecycle messages as info", () => {
    const event = classifyEvent({ source: "ui", line: "ready in 412 ms", isError: false });
    expect(event.category).toBe("lifecycle");
    expect(event.level).toBe("info");
  });

  it("keeps stderr-flagged unknown lines as errors", () => {
    const event = classifyEvent({ source: "host", line: "something unexpected", isError: true });
    expect(event.level).toBe("error");
  });
});

describe("resolveLogLevel", () => {
  it("defaults to warn", () => {
    expect(resolveLogLevel({})).toBe("warn");
  });

  it("honors BOS_LOG_LEVEL", () => {
    expect(resolveLogLevel({ BOS_LOG_LEVEL: "info" })).toBe("info");
    expect(resolveLogLevel({ BOS_LOG_LEVEL: "debug" })).toBe("debug");
  });

  it("flag beats env", () => {
    expect(resolveLogLevel({ BOS_LOG_LEVEL: "info" }, "error")).toBe("error");
  });

  it("DEBUG means show everything", () => {
    expect(resolveLogLevel({ DEBUG: "true" })).toBe("debug");
    expect(resolveLogLevel({ DEBUG: "1" })).toBe("debug");
  });

  it("ignores invalid values", () => {
    expect(resolveLogLevel({ BOS_LOG_LEVEL: "loud" })).toBe("warn");
  });
});

describe("createLogPipeline broadcast", () => {
  const makePipeline = (level?: Parameters<typeof createLogPipeline>[0]["level"]) => {
    const display: Array<{ source: string; line: string; isError: boolean }> = [];
    const file: string[] = [];
    const exported: string[] = [];
    const pipeline = createLogPipeline({
      level,
      sinks: {
        display: (event) =>
          display.push({
            source: event.source,
            line: event.line,
            isError: event.level === "error",
          }),
        file: (event) => file.push(event.line),
        export: (event) => exported.push(event.line),
      },
    });
    return { pipeline, display, file, exported };
  };

  it("file sink receives every line, display and export are filtered at warn", () => {
    const { pipeline, display, file, exported } = makePipeline();
    for (const raw of [
      ...toRaw(BANNER_BLOCK, "ui"),
      ...toRaw(RSPACK_CHATTER, "plugin:apps"),
      ...toRaw(DB_STARTUP, "api"),
      ...toRaw(BETTER_AUTH_WARN_STDOUT.slice(0, 1), "api"),
      ...toRaw(EFFECT_LOGGER_OBJECT, "api"),
    ]) {
      pipeline.ingest(raw);
    }
    pipeline.flush();

    expect(file).toHaveLength(
      BANNER_BLOCK.length + RSPACK_CHATTER.length + DB_STARTUP.length + 1 + 1,
    );
    expect(exported).toEqual(["WARN [Better Auth]: No API key provided, skipping request"]);
    expect(display.map((d) => d.line)).toEqual(exported);
  });

  it("collapsed [Database] startup reduces to a single db ready event per plugin at info", () => {
    const { pipeline, display } = makePipeline("info");
    for (const raw of toRaw(DB_STARTUP, "api")) pipeline.ingest(raw);
    pipeline.flush();

    expect(display).toEqual([{ source: "api", line: "db ready", isError: false }]);
  });

  it("db collapse is per plugin", () => {
    const { pipeline, display } = makePipeline("info");
    for (const raw of [...toRaw(DB_STARTUP, "api"), ...toRaw(DB_STARTUP, "auth")])
      pipeline.ingest(raw);
    pipeline.flush();

    expect(display.map((d) => d.source)).toEqual(["api", "auth"]);
  });

  it("a db error inside a startup run still surfaces", () => {
    const { pipeline, display } = makePipeline("info");
    for (const raw of [
      ...toRaw([DB_STARTUP[0]], "api"),
      ...toRaw(["[Database] Connection refused"], "api", true),
      ...toRaw([DB_STARTUP[2]], "api"),
    ])
      pipeline.ingest(raw);
    pipeline.flush();

    expect(display.map((d) => d.line)).toEqual([
      "db ready",
      "[Database] Connection refused",
      "db ready",
    ]);
  });

  it("--log-level info restores lifecycle chatter on the display tail", () => {
    const { pipeline, display } = makePipeline("info");
    for (const raw of toRaw(["ready in 412 ms", "Listening on http://localhost:3001"], "ui"))
      pipeline.ingest(raw);
    pipeline.flush();

    expect(display).toHaveLength(2);
  });

  it("DEBUG shows everything on the display tail", () => {
    const { pipeline, display } = makePipeline("debug");
    for (const raw of [...toRaw(BANNER_BLOCK, "ui"), ...toRaw(RSPACK_CHATTER, "host")])
      pipeline.ingest(raw);
    pipeline.flush();

    expect(display).toHaveLength(BANNER_BLOCK.length + RSPACK_CHATTER.length);
  });

  it("clean quit exit lines never reach the display tail and export carries no [ERR] prefix", () => {
    const { pipeline, display, exported } = makePipeline();
    for (const raw of toRaw(["Process exited after ready (exit code: 0)"], "api", true))
      pipeline.ingest(raw);
    for (const raw of toRaw(["Process exited after ready (exit code: 0)"], "ui", true))
      pipeline.ingest(raw);
    pipeline.flush();

    expect(display).toHaveLength(0);
    expect(exported).toHaveLength(0);
  });

  it("normalizes continuation lines across ingest boundaries within one source", () => {
    const { pipeline, file } = makePipeline();
    for (const line of EFFECT_LOGGER_OBJECT) pipeline.ingest({ source: "api", line });
    pipeline.flush();

    expect(file).toHaveLength(1);
    expect(file[0]).toContain("Request context");
    expect(file[0]).toContain("}");
  });

  it("separates multi-line blocks per source", () => {
    const { pipeline, file } = makePipeline();
    pipeline.ingest({ source: "api", line: "[INFO] (api) Request context" });
    pipeline.ingest({ source: "ui", line: "ready in 412 ms" });
    pipeline.ingest({ source: "api", line: "{" });
    pipeline.ingest({ source: "api", line: '  "a": 1' });
    pipeline.ingest({ source: "api", line: "}" });
    pipeline.flush();

    expect(file).toEqual(['[INFO] (api) Request context\n{\n  "a": 1\n}', "ready in 412 ms"]);
  });
});
