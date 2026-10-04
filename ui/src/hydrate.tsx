/**
 * Client bootstrap — wires the app's router factory, generated core manifest,
 * and generated route config into the framework hydrator (MF `./Hydrate`
 * expose).
 *
 * BE CAREFUL MODIFYING THIS FILE — changes will be overwritten by `bos sync` / `bos upgrade`.
 * Prefer upstream changes at https://github.com/nearbuilders/everything-dev
 */

import "./styles.css";
import { hydrate as coreHydrate } from "everything-dev/ui/hydrate";
import { createRouter } from "./router";

export function hydrate() {
  return coreHydrate({
    routeConfig: () => import("./routeConfig.gen"),
    manifest: () => import("./manifest.gen.json"),
    createRouter,
  });
}

export default hydrate;
