import type { CommandDescriptor } from "./catalog";
import { commandCatalog } from "./catalog";
import { flagHelpLines } from "./flags";

export function printHelp() {
  process.stdout.write(`everything-dev commands\n\n`);

  for (const command of commandCatalog) {
    process.stdout.write(`  everything-dev ${command.commandPath.join(" ")}`);
    process.stdout.write(command.meta.longRunning ? " (long running)" : "");
    process.stdout.write(`\n    ${command.summary}\n`);
  }

  process.stdout.write(`\n'bos' is an alias for 'everything-dev'.\n`);
}

/** Per-command help — flags derive from the contract schemas (the one flag
 * source), command text from the contract's command meta. */
export function printCommandHelp(descriptor: CommandDescriptor) {
  process.stdout.write(`everything-dev ${descriptor.commandPath.join(" ")}\n`);
  process.stdout.write(`  ${descriptor.summary}\n`);
  if (descriptor.meta.longRunning) process.stdout.write("  (long running)\n");
  const flags = flagHelpLines(descriptor);
  if (flags.length > 0) {
    process.stdout.write(`\nflags:\n`);
    for (const line of flags) process.stdout.write(`${line}\n`);
  }
  process.stdout.write(`\n'bos' is an alias for 'everything-dev'.\n`);
}
