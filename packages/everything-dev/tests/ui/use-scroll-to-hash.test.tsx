// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollToHash } from "../../src/ui/use-scroll-to-hash";

const harness = vi.hoisted(() => ({ hash: "" }));

vi.mock("@tanstack/react-router", () => ({
  useLocation: ({ select }: { select: (location: { hash: string }) => string }) =>
    select({ hash: harness.hash }),
}));

function Section({ show }: { show: boolean }) {
  const ref = useScrollToHash<HTMLDivElement>("payouts");
  return show ? <div id="payouts" ref={ref} /> : null;
}

let container: HTMLDivElement;
let root: Root;
const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  harness.hash = "payouts";
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(show: boolean) {
  await act(async () => root.render(<Section show={show} />));
}

describe("useScrollToHash", () => {
  it("scrolls to the section once it appears after data loads", async () => {
    await render(false);
    expect(scrollIntoView).not.toHaveBeenCalled();

    await render(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("payouts"));
  });

  it("scrolls only once while the hash stays the same", async () => {
    await render(true);
    await render(true);
    await render(false);
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("ignores other hashes", async () => {
    harness.hash = "updates";
    await render(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolls again when the hash returns after leaving", async () => {
    await render(true);
    harness.hash = "";
    await render(true);
    harness.hash = "payouts";
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
