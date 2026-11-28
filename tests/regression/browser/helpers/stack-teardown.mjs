import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

export default function stackTeardown() {
  const mode = process.env.REGRESSION_MODE ?? "";
  if (!mode.startsWith("start:")) {
    return;
  }
  const variant = mode.slice("start:".length);
  if (!["ssr", "csr"].includes(variant)) {
    return;
  }
  const result = spawnSync(
    "node",
    [path.join("tests", "regression", "lib", "regression-stack.mjs"), "teardown", variant],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(`stack teardown failed (exit ${result.status})`);
    process.exitCode = 1;
  }
}
