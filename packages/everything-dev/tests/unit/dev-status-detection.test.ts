import { describe, expect, it } from "vitest";
import { detectStatus } from "../../src/orchestrator";
import type { ServiceDescriptor } from "../../src/service-descriptor";

const pluginDescriptor = {
  command: "bun",
  args: ["run", "dev"],
  readyPatterns: [/ready in/i, /compiled.*successfully/i, /Plugin dev server ready/i],
  errorPatterns: [/\bERROR in\b/, /failed to compile/i, /Module not found/i, /Cannot find module/i],
  defaultPort: 3010,
  readinessPath: "/",
} satisfies ServiceDescriptor;

describe("detectStatus false-positive guards (host/ui patterns)", () => {
  const hostDescriptor = {
    command: "bun",
    args: ["run", "dev"],
    readyPatterns: [/Host (dev|production) server running at/i, /Server running at/i],
    errorPatterns: [/\berror\b(?!s)/i, /\bfailed to\b/i, /\bbuild failed\b/i, /exception/i],
    defaultPort: 3000,
    readinessPath: "/",
  } satisfies ServiceDescriptor;

  const uiDescriptor = {
    command: "bun",
    args: ["run", "dev"],
    readyPatterns: [/\bready\s+built in\b/i, /\bLocal:\b/i, /\bcompiled\b.*successfully/i],
    errorPatterns: [/\berror\b(?!s)/i, /\bfailed to\b/i, /\bbuild failed\b/i],
    defaultPort: 3003,
    readinessPath: "/remoteEntry.js",
  } satisfies ServiceDescriptor;

  it("counts as ready, not error: 'compiled successfully (0 errors)'", () => {
    expect(detectStatus("compiled successfully (0 errors)", uiDescriptor)).toMatchObject({
      status: "ready",
    });
  });

  it("does not mark '0 failed' or 'watcher failed, retrying' style lines as errors", () => {
    expect(detectStatus("build finished: 0 failed", hostDescriptor)).toBeNull();
  });

  it("still marks real errors on the same line shapes", () => {
    expect(detectStatus("Failed to compile: cannot resolve module", uiDescriptor)).toMatchObject({
      status: "error",
    });
    expect(detectStatus("Build failed: cannot resolve module", uiDescriptor)).toMatchObject({
      status: "error",
    });
    expect(detectStatus("uncaught exception in boot", hostDescriptor)).toMatchObject({
      status: "error",
    });
  });

  it("ready patterns win over error patterns on overlapping lines", () => {
    expect(detectStatus("Local: ready built in 412 ms (0 errors)", uiDescriptor)).toMatchObject({
      status: "ready",
    });
  });
});

describe("detectStatus with plugin error patterns", () => {
  it("does not mark errors when a warning mentions an identifier containing 'Error'", () => {
    expect(
      detectStatus(
        "⚠ ESModulesLinkingWarning: export 'isRetryableMigrationError' was not found in 'everything-dev/db'",
        pluginDescriptor,
      ),
    ).toBeNull();
  });

  it("does not mark errors for successful compiles with warnings", () => {
    expect(detectStatus("Rspack compiled with 1 warning", pluginDescriptor)).toBeNull();
  });

  it("marks errors for rspack compile failures", () => {
    expect(detectStatus("ERROR in ./src/db/migrate.ts", pluginDescriptor)).toMatchObject({
      status: "error",
    });
    expect(detectStatus("ERROR: failed to compile app", pluginDescriptor)).toMatchObject({
      status: "error",
    });
    expect(
      detectStatus("Module not found: Can't resolve './missing'", pluginDescriptor),
    ).toMatchObject({ status: "error" });
  });

  it("marks ready for plugin dev server output", () => {
    expect(detectStatus("ready in 431 ms", pluginDescriptor)).toMatchObject({
      status: "ready",
    });
    expect(detectStatus("Rspack compiled successfully", pluginDescriptor)).toMatchObject({
      status: "ready",
    });
  });
});
