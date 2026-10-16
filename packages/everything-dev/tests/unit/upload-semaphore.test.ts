import { describe, expect, it } from "vitest";
import { createSemaphore } from "../../src/services/deploy/train";

describe("createSemaphore", () => {
  it("hands the released slot to a waiter instead of freeing it", async () => {
    const sem = createSemaphore(2);
    const releaseOne = await sem.acquire();
    const releaseTwo = await sem.acquire();

    let thirdAcquired = false;
    const third = sem.acquire().then((release) => {
      thirdAcquired = true;
      return release;
    });
    let fourthAcquired = false;
    const fourth = sem.acquire().then(() => {
      fourthAcquired = true;
    });
    await Promise.resolve();
    expect(thirdAcquired).toBe(false);

    releaseOne();
    await third;
    expect(thirdAcquired).toBe(true);
    releaseTwo();
    await fourth;
    expect(fourthAcquired).toBe(true);

    let fifthAcquired = false;
    const fifth = sem.acquire().then(() => {
      fifthAcquired = true;
    });
    await Promise.resolve();
    expect(fifthAcquired).toBe(false);

    (await third)();
    await fifth;
    expect(fifthAcquired).toBe(true);
  });

  it("never over-admits across a long acquire/release churn", async () => {
    const sem = createSemaphore(3);
    let current = 0;
    let max = 0;

    const work = async (): Promise<void> => {
      const release = await sem.acquire();
      current += 1;
      max = Math.max(max, current);
      await Promise.resolve();
      current -= 1;
      release();
    };

    for (let round = 0; round < 20; round++) {
      await Promise.all(Array.from({ length: 10 }, () => work()));
    }

    expect(max).toBe(3);
  });
});
