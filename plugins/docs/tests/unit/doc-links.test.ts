import { describe, expect, it } from "vitest";
import { dedupeLeadingTitle, resolveDocHref } from "../../ui/src/components/docs/doc-links";

describe("resolveDocHref", () => {
  it("resolves sibling markdown files to app routes", () => {
    expect(resolveDocHref("./0001-fastkv-registry-namespace-signer.md", "adr/README")).toBe(
      "/docs/adr/0001-fastkv-registry-namespace-signer",
    );
  });

  it("walks up directories relative to the current doc", () => {
    expect(resolveDocHref("../plans/done/034-manifest-composition-rework.md", "adr/0007")).toBe(
      "/docs/plans/done/034-manifest-composition-rework",
    );
  });

  it("maps the glossary to its special slug", () => {
    expect(resolveDocHref("../../GLOSSARY.md", "agents/how-it-fits")).toBe("/docs/glossary");
  });

  it("maps directory links to the directory route", () => {
    expect(resolveDocHref("../adr/", "agents/change-placement")).toBe("/docs/adr");
  });

  it("strips a leading docs/ segment from rooted paths", () => {
    expect(resolveDocHref("docs/agents/testing.md", "adr/0050")).toBe("/docs/agents/testing");
  });

  it("preserves fragments", () => {
    expect(resolveDocHref("./other.md#decision", "adr/0051")).toBe("/docs/adr/other#decision");
  });

  it("leaves external schemes, fragments, and app routes alone", () => {
    expect(resolveDocHref("https://tanstack.com", "adr/0001")).toBe("https://tanstack.com");
    expect(resolveDocHref("#local-section", "adr/0001")).toBe("#local-section");
    expect(resolveDocHref("/docs/adr/0001", "adr/0001")).toBe("/docs/adr/0001");
    expect(resolveDocHref("mailto:dev@example.test", "adr/0001")).toBe("mailto:dev@example.test");
  });

  it("leaves non-markdown assets alone", () => {
    expect(resolveDocHref("./images/diagram.png", "adr/0001")).toBe("./images/diagram.png");
  });
});

describe("dedupeLeadingTitle", () => {
  it("drops a leading heading that restates the doc title", () => {
    expect(dedupeLeadingTitle("# Docs plugin\n\nBody text.\n", "Docs plugin")).toBe("Body text.\n");
  });

  it("keeps a different leading heading", () => {
    expect(dedupeLeadingTitle("# Other title\n\nBody.\n", "Docs plugin")).toBe(
      "# Other title\n\nBody.\n",
    );
  });

  it("keeps docs without a leading h1", () => {
    expect(dedupeLeadingTitle("Intro paragraph.\n", "Docs plugin")).toBe("Intro paragraph.\n");
  });
});
