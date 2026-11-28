const ACRONYMS: Record<string, string> = {
  adr: "ADR",
  ai: "AI",
  api: "API",
  cli: "CLI",
  db: "DB",
  mcp: "MCP",
  ssr: "SSR",
  ui: "UI",
};

export const prettifySegment = (segment: string): string =>
  segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
