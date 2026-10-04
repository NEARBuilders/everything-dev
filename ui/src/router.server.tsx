/**
 * SSR router — injects the app's authored router factory and generated route
 * tree into the framework SSR router module (MF `./Router` expose, node
 * entry), so server-rendered output uses the same router options the client
 * hydrates with.
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import { createServerRouterModule } from "everything-dev/ui/router-server";
import { createRouter } from "./router";
import { routeTree } from "./routeTree.gen";

const routerModule = createServerRouterModule({ defaultRouteTree: routeTree, createRouter });

export default routerModule;
