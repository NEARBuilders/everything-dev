import { computeRegressionEnv } from "./regression-env.mjs";

/**
 * HTTP org approval (ADR 0038 addendum): the stack database is in-process
 * pglite, so the direct-DB seed helper is gone — approval goes through the
 * admin route (`reviewOrganization`) using the boot-time bootstrap admin
 * API key. Spelled the same way the Go HTTP harness invokes it:
 * `node --import tsx tests/regression/lib/approve-test-organizations.ts <id…>`.
 */
const ids = process.argv.slice(2);
if (!ids.length) throw new Error("Organization fixture ids are required");

const env = computeRegressionEnv();
for (const organizationId of ids) {
  const response = await fetch(`${env.baseUrl}/api/rpc/auth/reviewOrganization`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: new URL(env.baseUrl).origin,
      "x-api-key": env.bootstrapAdminKey,
    },
    body: JSON.stringify({ json: { organizationId, decision: "approve" } }),
  });
  if (!response.ok) {
    throw new Error(`approving ${organizationId}: ${response.status} ${await response.text()}`);
  }
}
console.log(`[approve-test-organizations] approved: ${ids.join(", ")}`);
