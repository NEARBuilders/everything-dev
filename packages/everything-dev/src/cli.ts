#!/usr/bin/env node
import { runCli } from "./cli/main";

void runCli().catch((error) => {
  console.error("[CLI] Fatal error:", error);
  process.exit(1);
});
