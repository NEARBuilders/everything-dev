import { describe, expect, it } from "vitest";
import { commandCatalog } from "../../src/cli/catalog";
import { parseCommandInput } from "../../src/cli/parse";

describe("parseCommandInput", () => {
  const initDescriptor = commandCatalog.find((command) => command.key === "init");

  it("accepts boolean fields whose names already start with no-", () => {
    expect(initDescriptor).toBeDefined();

    const input = parseCommandInput(initDescriptor!, [
      "starter.everything.dev",
      "--extends",
      "dev.everything.near/everything.dev",
      "--account",
      "starter.near",
      "--directory",
      "/tmp/starter",
      "--overrides",
      "ui",
      "--no-interactive",
      "--no-install",
    ]) as {
      noInteractive: boolean;
      noInstall: boolean;
      overrides: string[];
    };

    expect(input.noInteractive).toBe(true);
    expect(input.noInstall).toBe(true);
    expect(input.overrides).toEqual(["ui"]);
  });

  it("still supports negated booleans for positive field names", () => {
    const startDescriptor = commandCatalog.find((command) => command.key === "start");

    expect(startDescriptor).toBeDefined();

    const input = parseCommandInput(startDescriptor!, ["--no-interactive"]) as {
      interactive: boolean;
    };

    expect(input.interactive).toBe(false);
  });

  it("parses per-service port flags for the dev command as kebab-case", () => {
    const devDescriptor = commandCatalog.find((command) => command.key === "dev");
    expect(devDescriptor).toBeDefined();

    const input = parseCommandInput(devDescriptor!, [
      "--api-port",
      "4001",
      "--ui-port",
      "4003",
      "--auth-port",
      "4002",
      "--plugin-port-start",
      "4010",
    ]) as {
      apiPort?: number;
      uiPort?: number;
      authPort?: number;
      pluginPortStart?: number;
    };

    expect(input.apiPort).toBe(4001);
    expect(input.uiPort).toBe(4003);
    expect(input.authPort).toBe(4002);
    expect(input.pluginPortStart).toBe(4010);
  });

  it("parses --port as the host port alias on the dev command", () => {
    const devDescriptor = commandCatalog.find((command) => command.key === "dev");
    expect(devDescriptor).toBeDefined();

    const input = parseCommandInput(devDescriptor!, ["--port", "4096"]) as { port?: number };
    expect(input.port).toBe(4096);
  });

  it("parses kill options (configDir, signal, all)", () => {
    const killDescriptor = commandCatalog.find((command) => command.key === "kill");
    expect(killDescriptor).toBeDefined();

    const input = parseCommandInput(killDescriptor!, [
      "--config-dir",
      "/tmp/project",
      "--signal",
      "SIGKILL",
      "--all",
    ]) as { configDir?: string; signal: string; all: boolean };

    expect(input.configDir).toBe("/tmp/project");
    expect(input.signal).toBe("SIGKILL");
    expect(input.all).toBe(true);
  });
});
