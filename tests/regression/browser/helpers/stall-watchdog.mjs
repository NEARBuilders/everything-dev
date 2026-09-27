import { execSync } from "node:child_process";

/**
 * Stall watchdog (ADR 0009): a suite that stops completing tests has died of
 * resource starvation — the job-level timeout kill would conclude "cancelled"
 * and the failure-artifact upload (if: failure()) would never fire, so no
 * stall would ever produce its evidence. This reporter fails the run within
 * minutes of zero test progress instead, printing a runner snapshot into the
 * job log first.
 *
 * The no-progress window exceeds any legitimate test: the per-test timeout is
 * 60s, so two minutes without a test *end* means the worker itself is wedged.
 */

const STALL_AFTER_MS = Number(process.env.STALL_WATCHDOG_MS) || 120_000;
const CHECK_EVERY_MS = 15_000;

function runnerSnapshot(label) {
  const lines = [`[stall-watchdog] ${label}`];
  // `free` and GNU `ps --sort` don't exist on macOS (BSD ps) — pick per platform.
  const commands =
    process.platform === "linux"
      ? ["free -m", "ps -eo pid,ppid,rss,etime,comm --sort=-rss | head -15"]
      : ["ps -axo rss,pid,ppid,etime,comm | sort -rn | head -15"];
  for (const command of commands) {
    try {
      lines.push(
        `[stall-watchdog] $ ${command}`,
        execSync(command, { timeout: 5_000 }).toString().trim(),
      );
    } catch (error) {
      lines.push(`[stall-watchdog] $ ${command} failed: ${error.message}`);
    }
  }
  return lines.join("\n");
}

export default class StallWatchdogReporter {
  lastProgressAt = Date.now();
  currentTest = null;
  timer = null;

  onBegin() {
    this.lastProgressAt = Date.now();
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
    this.timer.unref?.();
  }

  onTestStart(test) {
    this.lastProgressAt = Date.now();
    this.currentTest = test.title;
  }

  onTestEnd() {
    this.lastProgressAt = Date.now();
    this.currentTest = null;
  }

  onEnd() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  check() {
    const stalledFor = Date.now() - this.lastProgressAt;
    if (stalledFor < STALL_AFTER_MS) return;
    console.error(
      [
        `[stall-watchdog] SUITE STALLED — no test progress for ${Math.round(stalledFor / 1000)}s`,
        this.currentTest ? `[stall-watchdog] last test started: ${this.currentTest}` : undefined,
        runnerSnapshot("runner snapshot at stall"),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    process.exit(1);
  }
}
