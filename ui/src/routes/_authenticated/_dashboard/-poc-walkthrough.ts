import {
  PHASES,
  type PhaseDef,
  type PhaseId,
  type StationId,
  type StationState,
} from "./-poc-stations";

export type PhaseProgressState = "done" | "current" | "upcoming";

export interface PhaseProgress {
  phase: PhaseDef;
  done: number;
  total: number;
  state: PhaseProgressState;
}

const settled = (station: StationState) =>
  station.status === "done" || station.status === "skipped";

export function phaseProgress(
  stations: readonly StationState[],
  activePhase: PhaseId,
  phases: readonly PhaseDef[] = PHASES,
): PhaseProgress[] {
  return phases.map((phase) => {
    const inPhase = stations.filter((station) => station.def.phase === phase.id);
    const done = inPhase.filter(settled).length;
    const state: PhaseProgressState =
      inPhase.length > 0 && done === inPhase.length
        ? "done"
        : phase.id === activePhase
          ? "current"
          : "upcoming";
    return { phase, done, total: inPhase.length, state };
  });
}

export function resolvePhase(
  stations: readonly StationState[],
  selected: PhaseId | null,
  phases: readonly PhaseDef[] = PHASES,
): PhaseId {
  if (selected) return selected;
  const next = stations.find((station) => !settled(station));
  return next?.def.phase ?? phases[phases.length - 1]?.id ?? "stand-up";
}

export function resolveFocus(
  stations: readonly StationState[],
  phase: PhaseId,
  selected: StationId | null,
): StationState | null {
  const inPhase = stations.filter((station) => station.def.phase === phase);
  return (
    inPhase.find((station) => station.def.id === selected) ??
    inPhase.find((station) => !settled(station)) ??
    inPhase[0] ??
    null
  );
}

export function followingStation(
  stations: readonly StationState[],
  current: StationId,
): StationState | null {
  const index = stations.findIndex((station) => station.def.id === current);
  if (index < 0) return null;
  return stations.slice(index + 1).find((station) => !settled(station)) ?? null;
}
