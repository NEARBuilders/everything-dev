import type { BosConfigInput } from "./types";

type ComposableConfig = Record<string, unknown> & {
  app?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
};

export function listComposableSections(config: BosConfigInput): string[] {
  const source = config as ComposableConfig;
  const sections: string[] = [];

  for (const key of ["host", "ui", "api", "auth"]) {
    if (source.app?.[key]) sections.push(`app.${key}`);
  }
  for (const key of Object.keys(source.plugins ?? {})) {
    sections.push(`plugins.${key}`);
  }

  return sections;
}

export function applyRegistrySections(
  local: BosConfigInput,
  remote: BosConfigInput,
  sections: string[],
): { config: BosConfigInput; applied: string[] } {
  const available = listComposableSections(remote);
  const unknown = sections.filter((section) => !available.includes(section));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown section(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`,
    );
  }

  const merged = structuredClone(local) as ComposableConfig;

  for (const section of sections) {
    if (section.startsWith("app.")) {
      const key = section.slice("app.".length);
      merged.app = { ...merged.app, [key]: (remote as ComposableConfig).app?.[key] };
    } else {
      const key = section.slice("plugins.".length);
      merged.plugins = {
        ...merged.plugins,
        [key]: (remote as ComposableConfig).plugins?.[key],
      };
    }
  }

  return { config: merged as BosConfigInput, applied: sections };
}
