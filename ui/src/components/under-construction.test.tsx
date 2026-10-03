// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MotionConfig } from "framer-motion";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnderConstruction } from "./under-construction";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("UnderConstruction", () => {
  it("renders on the server within the existing reduced-motion provider", () => {
    const html = renderToStaticMarkup(
      <MotionConfig reducedMotion="always">
        <UnderConstruction label="Library" url="https://example.test/source" pressed />
      </MotionConfig>,
    );
    expect(html).toContain('aria-label="Library under construction - view source"');
    expect(html).toContain("In progress");
    expect(html).not.toContain("<img");
  });

  it("preserves the delayed source link and click callback", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <UnderConstruction label="Library" url="https://example.test/source" onClick={onClick} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Library under construction - view source" }),
    );
    expect(onClick).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(open).toHaveBeenCalledWith(
      "https://example.test/source",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("keeps a local action from opening the source link", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <UnderConstruction
        label="Library"
        url="https://example.test/source"
        skipNavigation
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Library under construction" }));
    act(() => vi.advanceTimersByTime(150));
    expect(onClick).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });
});
