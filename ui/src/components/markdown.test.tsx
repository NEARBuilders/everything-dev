import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders headings, links, and lists with the default variant", () => {
    const html = renderToStaticMarkup(
      <Markdown content={"# Title\n\n[link](https://example.test)\n\n- one\n- two"} />,
    );
    expect(html).toContain("Title");
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("one");
  });

  it("escapes raw HTML instead of executing it", () => {
    const html = renderToStaticMarkup(
      <Markdown content={'<script>alert("x")</script>\n\nSafe paragraph.'} />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Safe paragraph.");
  });

  it("blocks javascript: URLs in links", () => {
    const html = renderToStaticMarkup(<Markdown content={"[click me](javascript:alert(1))"} />);
    expect(html).not.toContain("javascript:");
  });

  it("applies compact spacing for the compact variant", () => {
    const defaultHtml = renderToStaticMarkup(<Markdown content="# Title" />);
    const compactHtml = renderToStaticMarkup(<Markdown content="# Title" variant="compact" />);
    expect(defaultHtml).toContain("text-3xl");
    expect(compactHtml).toContain("text-lg");
    expect(compactHtml).not.toContain("text-3xl");
  });
});
