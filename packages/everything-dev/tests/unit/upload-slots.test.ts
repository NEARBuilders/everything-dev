import { describe, expect, it } from "vitest";
import { createSlotLimiter } from "../../src/services/deploy/upload-slots";

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function gatedTask() {
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { done, release };
}

describe("createSlotLimiter", () => {
  it("a freed slot is handed to exactly one waiter — later arrivals still wait", async () => {
    const limit = createSlotLimiter(2);
    const running = { now: 0, max: 0 };
    const track = (task: { done: Promise<void> }) => async () => {
      running.now++;
      running.max = Math.max(running.max, running.now);
      await task.done;
      running.now--;
    };
    const first = gatedTask();
    const second = gatedTask();
    const queued = gatedTask();
    const results: Array<Promise<void>> = [];
    results.push(limit(track(first)), limit(track(second)), limit(track(queued)));
    await settled();
    expect(running.now).toBe(2);

    first.release();
    await settled();
    expect(running.now).toBe(2);

    const late = gatedTask();
    results.push(limit(track(late)));
    await settled();
    expect(running.now).toBe(2);

    second.release();
    queued.release();
    late.release();
    await Promise.all(results);
    expect(running.max).toBe(2);
  });

  it("drains a queue deeper than the cap without ever exceeding it", async () => {
    for (const cap of [1, 3, 8]) {
      const limit = createSlotLimiter(cap);
      let now = 0;
      let max = 0;
      const outcomes = await Promise.all(
        Array.from({ length: 200 }, (_, i) =>
          limit(async () => {
            now++;
            max = Math.max(max, now);
            await new Promise<void>((resolve) => setTimeout(resolve, (i % 5) + 1));
            now--;
            return i * 2;
          }),
        ),
      );
      expect(max).toBeLessThanOrEqual(cap);
      expect(max).toBe(cap);
      expect(outcomes).toEqual(Array.from({ length: 200 }, (_, i) => i * 2));
    }
  });

  it("a task that throws still frees its slot", async () => {
    const limit = createSlotLimiter(1);
    const failure = limit(async () => {
      throw new Error("upload failed");
    });
    await expect(failure).rejects.toThrow("upload failed");
    await expect(
      limit(async () => {
        return "recovered";
      }),
    ).resolves.toBe("recovered");
  });
});
