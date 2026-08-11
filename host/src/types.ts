import type { RuntimeConfig } from "./services/config";

export type { HeadData, RenderOptionsWithApi, RouterModule } from "everything-dev/ui/types";
export type { RuntimeConfig } from "./services/config";

export type RuntimePlugin = NonNullable<RuntimeConfig["plugins"]>[string];
