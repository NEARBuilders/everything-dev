import chalk from "chalk";

const hex =
  (code: string) =>
  (text: string): string =>
    chalk.hex(code)(text);

const truecolorRamp =
  (from: string, to: string) =>
  (text: string): string => {
    const rgb = (code: string) => [1, 3, 5].map((i) => parseInt(code.slice(i, i + 2), 16));
    const [r1, g1, b1] = rgb(from);
    const [r2, g2, b2] = rgb(to);
    const chars = [...text];
    const total = chars.filter((ch) => ch !== "\n").length;
    let seen = 0;
    return chars
      .map((ch) => {
        if (ch === "\n") return ch;
        const t = total > 1 ? seen / (total - 1) : 0;
        seen += 1;
        return chalk.rgb(
          Math.round(r1 + (r2 - r1) * t),
          Math.round(g1 + (g2 - g1) * t),
          Math.round(b1 + (b2 - b1) * t),
        )(ch);
      })
      .join("");
  };

export const gradients: Record<string, (text: string) => string> = {
  cyber: truecolorRamp("#00ffff", "#ff00ff"),
};

export const colors = {
  cyan: hex("#00ffff"),
  magenta: hex("#ff00ff"),
  green: hex("#00ff41"),
  blue: hex("#0080ff"),
  yellow: hex("#ffcc00"),
  orange: hex("#ffaa00"),
  white: hex("#f0f0f0"),
  gray: hex("#555555"),
  dim: chalk.dim,
  error: hex("#ff3366"),
};

export const icons = {
  scan: "○",
  run: "▶",
  ok: "✓",
  err: "✗",
  pending: "○",
  arrow: "→",
  dot: "·",
  app: "◉",
  config: "⚙",
};

export const frames = {
  top: (width: number) => `┌${"─".repeat(width - 2)}┐`,
  bottom: (width: number) => `└${"─".repeat(width - 2)}┘`,
};

export function divider(width = 48): string {
  return chalk.dim("─".repeat(width));
}
