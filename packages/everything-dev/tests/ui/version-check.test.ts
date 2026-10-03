import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startVersionWatch } from "../../src/ui/version-check";

describe("startVersionWatch", () => {
  let listeners: Map<string, Array<() => void>>;

  const fakeDocument = () => {
    listeners = new Map();
    return {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (type: string, fn: () => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((f) => f !== fn),
        );
      },
    };
  };

  const setVisibility = (state: DocumentVisibilityState) => {
    (fakeDoc as { visibilityState: DocumentVisibilityState }).visibilityState = state;
    for (const fn of listeners.get("visibilitychange") ?? []) fn();
  };

  let fakeDoc: ReturnType<typeof fakeDocument>;
  let fetchImpl: ReturnType<typeof vi.fn>;
  let onNewVersion: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeDoc = fakeDocument();
    onNewVersion = vi.fn();
    fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ fingerprint: "v2" }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const start = (overrides?: Partial<Parameters<typeof startVersionWatch>[0]>) =>
    startVersionWatch({
      currentFingerprint: "v1",
      onNewVersion,
      documentRef: fakeDoc as unknown as Document,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...overrides,
    });

  it("calls onNewVersion when the served fingerprint differs", async () => {
    start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(onNewVersion).toHaveBeenCalledTimes(1);
  });

  it("reports once per session (no repeat calls for the same mismatch)", async () => {
    start();
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(onNewVersion).toHaveBeenCalledTimes(1);
  });

  it("skips polling while the document is hidden and resumes on visibility", async () => {
    start();
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fetchImpl).not.toHaveBeenCalled();

    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(61_000);
    expect(onNewVersion).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the fingerprint matches", async () => {
    fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ fingerprint: "v1" }), { status: 200 }),
    );
    start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it("stop() halts polling", async () => {
    const handle = start();
    handle.stop();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
