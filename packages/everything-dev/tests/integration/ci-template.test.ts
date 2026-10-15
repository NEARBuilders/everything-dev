import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = join(import.meta.dirname, "../../../../");
const CI_TEMPLATE_PATH = join(REPO_ROOT, ".github", "templates", "workflows", "ci.yml");

type WorkflowDoc = {
  on?: {
    push?: { "paths-ignore"?: string[]; branches?: string[] };
    pull_request?: { "paths-ignore"?: string[]; branches?: string[] };
    workflow_dispatch?: unknown;
  };
  jobs?: Record<
    string,
    {
      name?: string;
      needs?: string | string[];
      if?: string;
      uses?: string;
      steps?: Array<{ run?: string }>;
    }
  >;
};

function loadCiTemplate(): WorkflowDoc {
  return parseYaml(readFileSync(CI_TEMPLATE_PATH, "utf-8")) as WorkflowDoc;
}

describe("consumer CI template (.github/templates/workflows/ci.yml)", () => {
  it("keeps paths-ignore on push but not on pull_request", () => {
    const doc = loadCiTemplate();

    expect(doc.on?.push?.["paths-ignore"]).toBeDefined();
    expect(doc.on?.pull_request?.["paths-ignore"]).toBeUndefined();
  });

  it("ships a slash-free caller-side gate job that fails unless the ci job succeeded", () => {
    const doc = loadCiTemplate();

    const gateJobs = Object.entries(doc.jobs ?? {}).filter(
      ([, job]) => job.uses === undefined && job.needs !== undefined,
    );
    expect(gateJobs).toHaveLength(1);

    const [gateId, gate] = gateJobs[0]!;

    expect(gateId).toBe("lint-and-typecheck-gate");
    expect(gate.name).toBe("Lint and Type Check");
    expect(gate.name).not.toContain("/");
    expect(gate.needs).toEqual(["ci"]);
    expect(gate.if).toBe("always()");

    const gateStepRuns = gate.steps?.map((step) => step.run ?? "").join("\n");
    expect(gateStepRuns).toContain("needs.ci.result");
  });
});
