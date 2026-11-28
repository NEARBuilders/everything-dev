import { describe, expect, it } from "vitest";
import {
  dedupeLeadingTitle,
  repositoryUrl,
  resolveDocHref,
} from "../../ui/src/components/docs/doc-links";

const REPOSITORY = "https://github.com/nearbuilders/everything-dev";
const corpus = new Set([
  "README",
  "glossary",
  "book/README",
  "book/01-the-model",
  "adr/README",
  "adr/0001-fastkv-registry-namespace-signer",
  "adr/0007-runtime-composition-ssr",
  "plugins/auth/contract",
  "plugins/auth/install",
]);
const inCorpus = { slugs: corpus, repository: REPOSITORY };

describe("resolveDocHref — documents in the corpus", () => {
  it("resolves sibling markdown files to reader routes", () => {
    expect(
      resolveDocHref("./0001-fastkv-registry-namespace-signer.md", "docs/adr/README.md", inCorpus),
    ).toBe("/docs/adr/0001-fastkv-registry-namespace-signer");
  });

  it("walks up directories relative to the document's own file", () => {
    expect(
      resolveDocHref(
        "../adr/0007-runtime-composition-ssr.md",
        "docs/book/04-composition.md",
        inCorpus,
      ),
    ).toBe("/docs/adr/0007-runtime-composition-ssr");
  });

  it("maps the glossary to its special slug", () => {
    expect(resolveDocHref("../../GLOSSARY.md", "docs/agents/how-it-fits.md", inCorpus)).toBe(
      "/docs/glossary",
    );
  });

  it("maps a directory that holds documents to the directory route", () => {
    expect(resolveDocHref("../adr/", "docs/agents/change-placement.md", inCorpus)).toBe(
      "/docs/adr",
    );
  });

  it("resolves extension-less links to a page when the corpus has one", () => {
    expect(resolveDocHref("../book/01-the-model", "docs/README.md", inCorpus)).toBe(
      "/docs/book/01-the-model",
    );
  });

  it("resolves a plugin document's links against its real file, not its slug", () => {
    const file = "plugins/auth/docs/install.md";
    expect(resolveDocHref("../../../GLOSSARY.md", file, inCorpus)).toBe("/docs/glossary");
    expect(resolveDocHref("./contract.md", file, inCorpus)).toBe("/docs/plugins/auth/contract");
    expect(resolveDocHref("../src/index.ts", file, inCorpus)).toBe(
      "https://github.com/nearbuilders/everything-dev/blob/HEAD/plugins/auth/src/index.ts",
    );
  });

  it("strips a leading docs/ segment from rooted paths", () => {
    expect(
      resolveDocHref("docs/adr/0007-runtime-composition-ssr.md", "docs/book/README.md", inCorpus),
    ).toBe("/docs/adr/0007-runtime-composition-ssr");
    expect(resolveDocHref("/AGENTS.md", "docs/book/README.md", inCorpus)).toBe(
      "https://github.com/nearbuilders/everything-dev/blob/HEAD/AGENTS.md",
    );
  });

  it("preserves fragments", () => {
    expect(
      resolveDocHref(
        "./0007-runtime-composition-ssr.md#decision",
        "docs/adr/0001-fastkv-registry-namespace-signer.md",
        inCorpus,
      ),
    ).toBe("/docs/adr/0007-runtime-composition-ssr#decision");
  });
});

describe("resolveDocHref — paths outside the corpus", () => {
  it("sends a markdown file the corpus does not include to the repository", () => {
    expect(resolveDocHref("../../AGENTS.md", "docs/book/02-anatomy.md", inCorpus)).toBe(
      "https://github.com/nearbuilders/everything-dev/blob/HEAD/AGENTS.md",
    );
  });

  it("sends a source file to the repository", () => {
    expect(
      resolveDocHref(
        "../../packages/everything-dev/src/contract.ts",
        "docs/book/02-anatomy.md",
        inCorpus,
      ),
    ).toBe(
      "https://github.com/nearbuilders/everything-dev/blob/HEAD/packages/everything-dev/src/contract.ts",
    );
  });

  it("sends a directory the corpus does not hold to the repository's tree view", () => {
    expect(resolveDocHref("../../host/", "docs/book/02-anatomy.md", inCorpus)).toBe(
      "https://github.com/nearbuilders/everything-dev/tree/HEAD/host",
    );
  });

  it("routes package skills to the site's skill family", () => {
    expect(
      resolveDocHref(
        "../../packages/everything-dev/skills/init-upgrade/SKILL.md",
        "docs/book/01-the-model.md",
        inCorpus,
      ),
    ).toBe("/skills/everything-dev/init-upgrade/SKILL.md");
  });

  it("routes public assets to the site root", () => {
    expect(resolveDocHref("../../ui/public/llms.txt", "docs/book/13-reference.md", inCorpus)).toBe(
      "/llms.txt",
    );
  });

  it("routes the root README to the About page, distinct from the docs map", () => {
    expect(resolveDocHref("../../README.md", "docs/book/README.md", inCorpus)).toBe("/about");
    expect(resolveDocHref("../README.md", "docs/book/README.md", inCorpus)).toBe("/docs/README");
  });

  it("preserves a fragment on a repository link", () => {
    expect(
      resolveDocHref(
        "../../AGENTS.md#troubleshooting",
        "docs/book/06-development-loop.md",
        inCorpus,
      ),
    ).toBe("https://github.com/nearbuilders/everything-dev/blob/HEAD/AGENTS.md#troubleshooting");
  });

  it("keeps the reader's own scheme when no repository is configured", () => {
    expect(resolveDocHref("../../AGENTS.md", "docs/book/02-anatomy.md", { slugs: corpus })).toBe(
      "/docs/AGENTS",
    );
  });
});

describe("resolveDocHref — an unknown corpus", () => {
  it("assumes a markdown link is compiled when the nav has not loaded", () => {
    expect(
      resolveDocHref("../../AGENTS.md", "docs/book/02-anatomy.md", { repository: REPOSITORY }),
    ).toBe("/docs/AGENTS");
  });

  it("still routes skills, public assets, and the root README", () => {
    expect(resolveDocHref("../../ui/public/skill.md", "docs/book/13-reference.md")).toBe(
      "/skill.md",
    );
    expect(resolveDocHref("../../README.md", "docs/book/13-reference.md")).toBe("/about");
  });
});

describe("resolveDocHref — left alone", () => {
  const file = "docs/adr/0001-fastkv-registry-namespace-signer.md";

  it("external schemes, fragments, and reader routes", () => {
    expect(resolveDocHref("https://tanstack.com", file, inCorpus)).toBe("https://tanstack.com");
    expect(resolveDocHref("#local-section", file, inCorpus)).toBe("#local-section");
    expect(resolveDocHref("/docs/adr/0007-runtime-composition-ssr", file, inCorpus)).toBe(
      "/docs/adr/0007-runtime-composition-ssr",
    );
    expect(resolveDocHref("mailto:dev@example.test", file, inCorpus)).toBe(
      "mailto:dev@example.test",
    );
  });

  it("a non-markdown asset when there is no repository to send it to", () => {
    expect(resolveDocHref("./images/diagram.png", file)).toBe("./images/diagram.png");
  });
});

describe("repositoryUrl", () => {
  it("addresses the default branch as HEAD so no branch name is guessed", () => {
    expect(repositoryUrl(REPOSITORY, "host/src/program.ts", false)).toBe(
      "https://github.com/nearbuilders/everything-dev/blob/HEAD/host/src/program.ts",
    );
    expect(repositoryUrl(REPOSITORY, "docs/adr", true)).toBe(
      "https://github.com/nearbuilders/everything-dev/tree/HEAD/docs/adr",
    );
  });

  it("accepts .git suffixes, trailing slashes, and subpaths", () => {
    for (const repository of [
      "https://github.com/nearbuilders/everything-dev.git",
      "https://github.com/nearbuilders/everything-dev/",
      "https://www.github.com/nearbuilders/everything-dev/tree/main/docs",
    ]) {
      expect(repositoryUrl(repository, "AGENTS.md", false)).toBe(
        "https://github.com/nearbuilders/everything-dev/blob/HEAD/AGENTS.md",
      );
    }
  });

  it("encodes each path segment", () => {
    expect(repositoryUrl(REPOSITORY, "docs/a b/notes & plans.md", false)).toBe(
      "https://github.com/nearbuilders/everything-dev/blob/HEAD/docs/a%20b/notes%20%26%20plans.md",
    );
  });

  it("declines a missing or non-GitHub repository", () => {
    expect(repositoryUrl(undefined, "AGENTS.md", false)).toBeUndefined();
    expect(repositoryUrl("", "AGENTS.md", false)).toBeUndefined();
    expect(repositoryUrl("https://gitlab.com/acme/app", "AGENTS.md", false)).toBeUndefined();
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
