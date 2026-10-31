export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 60_000) {
    const seconds = durationMs / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  }

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

import type { spinner as clackSpinner } from "@clack/prompts";

type Spinner = ReturnType<typeof clackSpinner>;

export interface PhaseTiming {
  name: string;
  durationMs: number;
}

const PHASE_LABELS: Record<string, string> = {
  "parent config": "Fetching parent config...",
  "template source": "Resolving template source...",
  "scaffold project": "Creating project scaffold...",
  "copy files": "Copying template files...",
  "personalize config": "Personalizing config...",
  "write snapshot": "Writing snapshot...",
  "resolve config": "Resolving config...",
  "generate env": "Generating environment config...",
  "create env file": "Creating .env file...",
  "install dependencies": "Installing dependencies...",
  "generate types": "Generating types...",
  "generate migrations": "Generating database migrations...",
  "generate code artifacts": "Generating code artifacts...",
};

function phaseLabel(name: string): string {
  return PHASE_LABELS[name] ?? name;
}

export async function timePhase<T>(
  timings: PhaseTiming[],
  name: string,
  fn: () => Promise<T>,
  spinner?: Spinner,
): Promise<T> {
  spinner?.message(phaseLabel(name));
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    timings.push({ name, durationMs: Date.now() - startedAt });
  }
}

export function sumPhaseDurations(timings: PhaseTiming[]): number {
  return timings.reduce((total, timing) => total + timing.durationMs, 0);
}
