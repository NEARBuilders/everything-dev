// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEAR_INTENTS_PROMPT, PRIVATE_INFERENCE_PROMPT } from "./-build-prompts";
import { Route as BuildRoute } from "./build";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const harness = vi.hoisted(() => ({
  clipboardWriteText: vi.fn(async () => undefined),
}));

async function renderBuild() {
  const queryClient = new QueryClient();
  const root = createRootRouteWithContext<Record<string, unknown>>()({ component: Outlet });
  const buildRoute = BuildRoute.update({
    ...BuildRoute.options,
    getParentRoute: () => root,
    path: "/build",
    id: undefined,
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([buildRoute as never]),
    history: createMemoryHistory({ initialEntries: ["/build"] }),
    context: { queryClient },
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: harness.clipboardWriteText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("build page", () => {
  it("renders the ready-to-build panel with both prompts", async () => {
    await renderBuild();

    expect(await screen.findByTestId("build.heading").then((el) => el.textContent)).toContain(
      "Ready to start building?",
    );
    expect(screen.getByTestId("build.prompt-private-inference").textContent).toContain(
      "Integrate NEAR AI Private Inference",
    );
    expect(screen.getByTestId("build.prompt-near-intents").textContent).toContain(
      "Integrate NEAR Intents",
    );
  });

  it("copies the exact prompt text", async () => {
    await renderBuild();

    fireEvent.click(await screen.findByTestId("build.prompt-private-inference"));

    await waitFor(() =>
      expect(harness.clipboardWriteText).toHaveBeenCalledWith(PRIVATE_INFERENCE_PROMPT),
    );
    expect(toast.success).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("build.prompt-near-intents"));

    await waitFor(() =>
      expect(harness.clipboardWriteText).toHaveBeenCalledWith(NEAR_INTENTS_PROMPT),
    );
    expect(harness.clipboardWriteText).toHaveBeenCalledTimes(2);
  });

  it("links directly to the NEAR AI Cloud and NEAR Intents docs", async () => {
    await renderBuild();

    const expected = [
      ["build.link-cloud", "https://cloud.near.ai"],
      ["build.link-models", "https://cloud.near.ai/models"],
      ["build.link-docs", "https://docs.near.ai"],
      ["build.link-intents-docs", "https://docs.near-intents.org"],
    ] as const;

    for (const [testId, href] of expected) {
      const anchor = await screen.findByTestId(testId);
      expect(anchor.getAttribute("href")).toBe(href);
      expect(anchor.getAttribute("target")).toBe("_blank");
    }
  });
});
