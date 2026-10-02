import { describe, expect, it } from "vitest";
import type { PhaseDef, StationState } from "./-poc-stations";
import { followingStation, phaseProgress, resolveFocus, resolvePhase } from "./-poc-walkthrough";

const phases: PhaseDef[] = [
  { id: "stand-up", title: "Initialize", blurb: "" },
  { id: "bootstrap", title: "Bootstrap", blurb: "" },
  { id: "vote", title: "Vote", blurb: "" },
];

function station(id: string, phase: PhaseDef["id"], status: StationState["status"]) {
  return { def: { id, phase }, status } as unknown as StationState;
}

const stations = [
  station("apply", "stand-up", "done"),
  station("approve", "stand-up", "skipped"),
  station("publish", "bootstrap", "done"),
  station("stake", "bootstrap", "ready"),
  station("vote", "vote", "blocked"),
];

describe("walkthrough", () => {
  it("counts settled stations per phase and marks the active one", () => {
    const progress = phaseProgress(stations, "bootstrap", phases);
    expect(progress.map((entry) => [entry.phase.id, entry.done, entry.total, entry.state])).toEqual(
      [
        ["stand-up", 2, 2, "done"],
        ["bootstrap", 1, 2, "current"],
        ["vote", 0, 1, "upcoming"],
      ],
    );
  });

  it("opens on the phase of the first unsettled station unless one is picked", () => {
    expect(resolvePhase(stations, null, phases)).toBe("bootstrap");
    expect(resolvePhase(stations, "vote", phases)).toBe("vote");
    expect(resolvePhase([station("apply", "stand-up", "done")], null, phases)).toBe("vote");
  });

  it("focuses the picked station, else the first unsettled one in the phase", () => {
    expect(resolveFocus(stations, "bootstrap", null)?.def.id).toBe("stake");
    expect(resolveFocus(stations, "bootstrap", "publish")?.def.id).toBe("publish");
    expect(resolveFocus(stations, "stand-up", "stake")?.def.id).toBe("apply");
    expect(resolveFocus(stations, "sponsor", null)).toBeNull();
  });

  it("finds the next station that still needs work", () => {
    expect(followingStation(stations, "apply")?.def.id).toBe("stake");
    expect(followingStation(stations, "vote")).toBeNull();
    expect(followingStation(stations, "missing" as never)).toBeNull();
  });
});
