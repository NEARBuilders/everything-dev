type SlotLimiter = <T>(task: () => Promise<T>) => Promise<T>;

/** Run independent async tasks at most `capacity` at a time; the rest wait
 * FIFO and start as slots free up. */
export function createSlotLimiter(capacity: number): SlotLimiter {
  const limit = Math.max(1, capacity);
  let inFlight = 0;
  const waiters: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (inFlight < limit) {
      inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = () => {
    // KEEP: a waking waiter inherits the slot and returns it through its own
    // release — freeing here as well hands one slot to two tasks and drifts
    // the cap (#970).
    const next = waiters.shift();
    if (next) next();
    else inFlight--;
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
