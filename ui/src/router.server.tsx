/**
 * SSR router — thin stub injecting the app's generated route tree into the
 * framework SSR router module (MF `./Router` expose, node entry).
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import { createServerRouterModule } from "everything-dev/ui/router-server";
import { routeTree } from "./routeTree.gen";

const routerModule = createServerRouterModule({ defaultRouteTree: routeTree });

export default routerModule;
