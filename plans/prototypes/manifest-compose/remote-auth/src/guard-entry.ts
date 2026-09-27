/**
 * Guard-variant expose (built when MF_GUARD_BUILD is set): imports react —
 * forcing the container to consume the shared module from the host's share
 * scope, where the strict version check fires — with NO route-file chunks.
 * A mismatched requiredVersion must reject the load with a version signature.
 */
import "react";

export const routeConfigLoaders: Record<string, () => Promise<never>> = {};
export const rootMeta = undefined;
