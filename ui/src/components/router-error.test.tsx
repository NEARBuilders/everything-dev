import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterError, shouldShowErrorDetails } from "./router-error";

const SCRIPT = '<script>alert("failure")</script>';

describe("shouldShowErrorDetails", () => {
  it("defaults to client-only — server render omits, client render shows", () => {
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
    vi.unstubAllGlobals();
  });

  it("renders on the client without application providers and escapes error details", () => {
    vi.stubGlobal("window", {});
    const markup = renderToStaticMarkup(<RouterError error={new Error(SCRIPT)} />);

    expect(markup).toContain("This page didn’t load");
    expect(markup).toContain("<summary");
    expect(markup).toContain("Error details");
    expect(markup).toContain('href="/"');
    expect(markup).toContain("Back home");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });

  it("omits the details block from server-rendered fallbacks by default", () => {
    const markup = renderToStaticMarkup(<RouterError error={new Error(SCRIPT)} />);

    expect(markup).toContain("This page didn’t load");
    expect(markup).not.toContain("<summary");
    expect(markup).not.toContain("Error details");
    expect(markup).not.toContain("script");
  });

  it("showErrorDetails={false} never renders the details block", () => {
    const markup = renderToStaticMarkup(
      <RouterError error={new Error(SCRIPT)} showErrorDetails={false} />,
    );

    expect(markup).toContain("This page didn’t load");
    expect(markup).not.toContain("<summary");
  });

  it("showErrorDetails={true} renders the details block even on the server, escaped", () => {
    const markup = renderToStaticMarkup(
      <RouterError error={new Error(SCRIPT)} showErrorDetails={true} />,
    );

    expect(markup).toContain("<summary");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });
});
