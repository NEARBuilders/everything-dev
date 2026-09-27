import { readFileSync } from "node:fs";
import { colors, divider, gradients } from "./theme";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as {
  version: string;
};

const ASCII_BOS = `
  ██████╗  ██████╗ ███████╗
  ██╔══██╗██╔═══██╗██╔════╝
  ██████╔╝██║   ██║███████╗
  ██╔══██╗██║   ██║╚════██║
  ██████╔╝╚██████╔╝███████║
  ╚═════╝  ╚═════╝ ╚══════╝`;

export function printBanner(title = "everything-dev", version = pkg.version) {
  console.log(gradients.cyber(ASCII_BOS));
  console.log();
  console.log(colors.dim(`  ${title} ${colors.cyan(`v${version}`)}`));
  console.log(colors.dim(`  ${divider(30)}`));
  console.log();
}
