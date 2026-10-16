export { formatDuration } from "../utils/timing";

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
  "generate env/docker": "Generating environment config...",
  "create env file": "Creating .env file...",
  "install dependencies": "Installing dependencies...",
  "generate types": "Generating types...",
  "generate migrations": "Generating database migrations...",
  "generate code artifacts": "Generating code artifacts...",
  "docker compose up": "Starting Docker services...",
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
