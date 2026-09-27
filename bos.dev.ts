import type { AppDescriptor } from "everything-dev/descriptor";

/**
 * Dev overlay for the everything.dev runtime (bos.app.ts) — merged
 * child-wins over the resolved config when the environment is development.
 * Never published. Example: pin the auth attachment to a running dev server
 * instead of letting the dev harness spawn it.
 */
export default {
  auth: { development: "http://localhost:3006" },
} satisfies Partial<AppDescriptor>;
