// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { RouterError, shouldShowErrorDetails } from "./router-error";

const SCRIPT = '<script>alert("failure")</script>';

describe("shouldShowErrorDetails", () => {
  it("defaults to client-only — suppressed while server-rendered or pre-reveal", () => {
    expect(shouldShowErrorDetails(undefined, true)).toBe(false);
    expect(shouldShowErrorDetails(undefined, false)).toBe(true);
  });

  it("false never shows, true always shows", () => {
    expect(shouldShowErrorDetails(false, false)).toBe(false);
    expect(shouldShowErrorDetails(false, true)).toBe(false);
    expect(shouldShowErrorDetails(true, false)).toBe(true);
    expect(shouldShowErrorDetails(true, true)).toBe(true);
  });
});

describe("router error fallback", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("omits the details block from server-rendered fallbacks by default", () => {
    const markup = renderToStaticMarkup(<RouterError error={new Error(SCRIPT)} />);

    expect(markup).toContain("This page didn’t load");
    expect(markup).not.toContain("<summary");
    expect(markup).not.toContain("Error details");
    expect(markup).not.toContain("script");
  });

  it("showErrorDetails={true} renders the details block even on the server, escaped", () => {
    const markup = renderToStaticMarkup(
      <RouterError error={new Error(SCRIPT)} showErrorDetails={true} />,
    );

    expect(markup).toContain("<summary");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("showErrorDetails={false} never renders the details block", () => {
    const markup = renderToStaticMarkup(
      <RouterError error={new Error(SCRIPT)} showErrorDetails={false} />,
    );

    expect(markup).toContain("This page didn’t load");
    expect(markup).not.toContain("<summary");
  });

  it("reveals the details block after a client mount, escaped", async () => {
    const screen = render(<RouterError error={new Error(SCRIPT)} />);

    await act(async () => {});
    const details = screen.getByText("Error details").closest("details");
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain('alert("failure")');
    expect(document.body.innerHTML).not.toContain("<script>alert");
  });
});
