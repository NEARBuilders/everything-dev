import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstanceReplacement } from "../../src/services/instance-replacement";

describe("InstanceReplacement — the default actuator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a committed replacement terminates this instance exactly once, with SIGTERM", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const replacement = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* InstanceReplacement;
      }).pipe(Effect.provide(InstanceReplacement.layer)),
    );

    await Effect.runPromise(replacement.replace(["ui", "api"]));

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
  });
});
