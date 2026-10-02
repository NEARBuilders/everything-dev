import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bulletin } from "./bulletin";

describe("Bulletin", () => {
  it("renders markdown content inside the info-tinted card", () => {
    const html = renderToStaticMarkup(<Bulletin content="**More features** are coming soon." />);
    expect(html).toContain("Bulletin");
    expect(html).toContain("More features");
    expect(html).toContain("bg-info-muted");
  });

  it("renders nothing for blank content", () => {
    const html = renderToStaticMarkup(<Bulletin content="   " />);
    expect(html).toBe("");
  });

  it("escapes hostile markdown content", () => {
    const html = renderToStaticMarkup(
      <Bulletin content={'<script>alert("x")</script>\n\nSafe.'} />,
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("Safe.");
  });

  it("includes the under-construction footer link", () => {
    const html = renderToStaticMarkup(
      <Bulletin
        content="More is coming."
        runtimeConfig={{ repository: "https://github.com/example/example" }}
      />,
    );
    expect(html).toContain("In progress");
  });
});
