import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnderConstruction } from "./under-construction";

describe("UnderConstruction", () => {
  it("links the GIF to the source file in the configured repository", () => {
    const html = renderToStaticMarkup(
      <UnderConstruction
        sourceFile="ui/src/routes/_public/index.tsx"
        runtimeConfig={{ repository: "https://github.com/example/example" }}
      />,
    );
    expect(html).toContain(
      'href="https://github.com/example/example/blob/main/ui/src/routes/_public/index.tsx"',
    );
    expect(html).toContain("<img");
  });

  it("prefers an explicit url over the repository", () => {
    const html = renderToStaticMarkup(
      <UnderConstruction
        url="https://example.test/source"
        runtimeConfig={{ repository: "https://github.com/example/example" }}
      />,
    );
    expect(html).toContain('href="https://example.test/source"');
  });

  it("renders the GIF without a link when there is nowhere to send people", () => {
    const html = renderToStaticMarkup(<UnderConstruction runtimeConfig={{}} />);
    expect(html).toContain("<img");
    expect(html).not.toContain("<a");
  });
});
