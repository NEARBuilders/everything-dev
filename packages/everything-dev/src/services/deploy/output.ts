import { colors, icons } from "../../utils/theme";

/**
 * The deploy output vocabulary: one grammar for every leg — `▶` phase
 * headers, `…` running lines, `✓` steps, `✗` failures — so the train reads
 * as a scannable story (phases in order, one line per fact, times not
 * attempt counts). Services print through these helpers; formats that only
 * a renderer should decide stay in cli/render.
 */

export function phase(title: string, detail?: string): void {
  console.log();
  console.log(colors.cyan(`  ${icons.run} ${title}${detail ? colors.dim(` — ${detail}`) : ""}`));
}

export function stepOk(message: string): void {
  console.log(`  ${colors.green(icons.ok)} ${message}`);
}

export function stepFail(message: string): void {
  console.log(`  ${colors.error(icons.err)} ${message}`);
}

export function running(message: string): void {
  console.log(`  ${colors.dim("…")} ${colors.dim(message)}`);
}

export function nearblocksUrl(txHash: string, network?: "mainnet" | "testnet"): string {
  const host = network === "testnet" ? "testnet.nearblocks.io" : "nearblocks.io";
  return `https://${host}/txns/${txHash}`;
}

export function nearblocksBlockUrl(
  blockHeight: number | string,
  network?: "mainnet" | "testnet",
): string {
  const host = network === "testnet" ? "testnet.nearblocks.io" : "nearblocks.io";
  return `https://${host}/block/${blockHeight}`;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
