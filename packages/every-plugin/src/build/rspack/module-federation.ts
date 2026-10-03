import { getPluginSharedDependencies } from "../../shared-deps-spec";
import type { PluginInfo } from "./utils";

export function buildSharedDependencies(_pluginInfo: PluginInfo) {
  return getPluginSharedDependencies();
}
