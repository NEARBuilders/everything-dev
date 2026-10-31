import type { PluginLoadFailureInfo } from "every-plugin/errors";
import { seedRegressionFixtures } from "../../lib/http-seed.mjs";

/**
 * The stack serves /health 200 even when a plugin failed to load (degraded
 * status). Specs that need the failed plugin would then fail with confusing
 * downstream timeouts, so abort here where the structured failure info is.
 */
async function failOnPluginLoadFailures(baseUrl: string) {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`[global-setup] /health returned ${response.status}`);
  }
  const health = (await response.json()) as { failures?: PluginLoadFailureInfo[] };
  if (health.failures?.length) {
    const rendered = health.failures
      .map(
        (f) =>
          `- ${f.pluginKey} (${f.operation ?? "load"}): [${f.kind}${f.retryable ? ", retryable" : ", permanent"}] ${f.message}${f.suggestion ? ` — ${f.suggestion}` : ""}`,
      )
      .join("\n");
    throw new Error(
      `[global-setup] the regression stack booted with failed plugin(s) — suite would fail with downstream timeouts:\n${rendered}`,
    );
  }
}

export default async function globalSetup() {
  const regressionEnv = (await import("../../lib/regression-env.mjs")).computeRegressionEnv();
  await failOnPluginLoadFailures(regressionEnv.baseUrl);

  await seedRegressionFixtures({
    log: (message) => console.log(`[global-setup] ${message}`),
  });
  console.log(`[global-setup] fixtures refreshed (HTTP seeding)`);
}
