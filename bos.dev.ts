import type { AppDescriptor } from "everything-dev/descriptor";

/**
 * Dev overlay for the everything.dev runtime (bos.app.ts) — merged
 * child-wins over the resolved config when the environment is development.
 * Never published. Example: pin the auth attachment to a running dev server
 * instead of letting the dev harness spawn it.
 */
export default {
  // Example — pin the auth attachment to a running dev server instead of
  // letting the dev harness spawn it. Commented out by default: while set,
  // every command that resolves config (types gen, typecheck, builds) talks
  // to this URL for the auth surface and degrades when it is down.
  // auth: { development: "http://localhost:3006" },
} satisfies Partial<AppDescriptor>;
