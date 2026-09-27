/**
 * The authored `bos.app.ts` source emitter — the scaffold surface of the
 * descriptor module. The descriptor is pure data (`toConfigInput` and its
 * inverse live in `./resolve`), so the scaffold emits the personalized
 * descriptor as a literal inside the `App()` call; publish/sync still
 * canonicalize the resolved config to JSON for FastKV.
 */

import type { BosConfigInput } from "../types";
import { configInputToDescriptor } from "./resolve";

/** The authored `bos.app.ts` source for a personalized child config. */
export function serializeAppDescriptorSource(input: BosConfigInput): string {
  const descriptor = configInputToDescriptor(input);
  return `import { App } from "everything-dev/descriptor";

export default App(${JSON.stringify(descriptor, null, 2)});
`;
}
