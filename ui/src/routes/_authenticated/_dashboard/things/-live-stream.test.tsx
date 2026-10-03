// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThingsLiveStreamPage } from "./-live-stream";

const harness = vi.hoisted(() => ({
  apiClient: { template: { subscribeThings: vi.fn() } },
  router: { history: { canGoBack: () => false, back: vi.fn() } },
}));

const defaultApiClient = harness.apiClient;

vi.mock("@/app", () => ({
  useApiClient: () => harness.apiClient,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => harness.router,
}));

afterEach(() => {
  cleanup();
  defaultApiClient.template.subscribeThings.mockReset();
  harness.apiClient = defaultApiClient;
  vi.clearAllMocks();
});

function event(thingId: string) {
  return {
    action: "created",
    thingId,
    type: "thing",
    timestamp: "2026-09-10T00:00:00.000Z",
  };
}

function stream(events: Array<ReturnType<typeof event>>) {
  return (async function* () {
    for (const nextEvent of events) yield nextEvent;
  })();
}

describe("live Thing stream", () => {
  it("keeps replayed payloads as separate rows and clears them", async () => {
    const replay = event("thing-1");
    harness.apiClient.template.subscribeThings.mockResolvedValue(stream([replay, replay]));

    render(<ThingsLiveStreamPage />);

    await waitFor(() => expect(screen.getAllByText("thing-1")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Clear (2)" }));
    expect(screen.queryByText("thing-1")).toBeNull();
  });

  it("keeps the newest 200 received rows", async () => {
    harness.apiClient.template.subscribeThings.mockResolvedValue(
      stream(Array.from({ length: 201 }, (_, index) => event(`thing-${index}`))),
    );

    render(<ThingsLiveStreamPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Clear (200)" })).toBeTruthy());
    expect(screen.getByText("thing-200")).toBeTruthy();
    expect(screen.queryByText("thing-0")).toBeNull();
  });

  it("aborts the old subscription and reconnects when the API client changes", async () => {
    let firstSignal: AbortSignal | undefined;
    const firstClient = {
      template: {
        subscribeThings: vi.fn((_input: unknown, options: { signal: AbortSignal }) => {
          firstSignal = options.signal;
          return new Promise(() => {});
        }),
      },
    };
    const secondClient = {
      template: {
        subscribeThings: vi.fn().mockResolvedValue(stream([event("thing-reconnected")])),
      },
    };

    harness.apiClient = firstClient;
    const view = render(<ThingsLiveStreamPage />);
    await waitFor(() => expect(firstClient.template.subscribeThings).toHaveBeenCalledOnce());

    harness.apiClient = secondClient;
    view.rerender(<ThingsLiveStreamPage />);

    await waitFor(() => expect(secondClient.template.subscribeThings).toHaveBeenCalledOnce());
    expect(firstSignal?.aborted).toBe(true);
    expect(await screen.findByText("thing-reconnected")).toBeTruthy();
  });

  it("retains an existing row DOM node when a newer event is prepended", async () => {
    let releaseSecond: (() => void) | undefined;
    const secondEvent = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const controlledStream = (async function* () {
      yield event("thing-old");
      await secondEvent;
      yield event("thing-new");
    })();
    harness.apiClient.template.subscribeThings.mockResolvedValue(controlledStream);

    render(<ThingsLiveStreamPage />);

    await screen.findByText("thing-old");
    const oldRow = screen.getByText("thing-old").parentElement?.parentElement?.parentElement;
    if (!oldRow) throw new Error("Expected the initial live event row");

    await act(async () => {
      releaseSecond?.();
    });
    await screen.findByText("thing-new");

    const retainedRow = screen.getByText("thing-old").parentElement?.parentElement?.parentElement;
    expect(retainedRow).toBe(oldRow);
  });

  it("does not mark a StrictMode-cleaned stream as connected when subscription resolves late", async () => {
    let resolveFirst: ((value: AsyncIterable<ReturnType<typeof event>>) => void) | undefined;
    const pendingStream = {
      next: () => new Promise<IteratorResult<ReturnType<typeof event>>>(() => {}),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    harness.apiClient.template.subscribeThings
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(stream([event("thing-2")]));

    render(
      <StrictMode>
        <ThingsLiveStreamPage />
      </StrictMode>,
    );

    await screen.findByText("thing-2");
    expect(screen.queryByTitle("Connected")).toBeNull();

    await act(async () => {
      resolveFirst?.(pendingStream);
    });
    expect(screen.queryByTitle("Connected")).toBeNull();
  });
});
