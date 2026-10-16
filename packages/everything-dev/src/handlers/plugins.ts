import type {
  PluginAddResult,
  PluginListResult,
  PluginPublishResult,
  PluginRemoveResult,
} from "../contract";
import { PluginAdminService } from "../services/plugins-admin";
import { ResolutionSessionService } from "../services/resolution/session";
import type { BosBuilder } from "./shared";

export function registerPlugins(builder: BosBuilder) {
  return {
    pluginAdd: builder.pluginAdd.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const admin = yield* PluginAdminService;
      return yield* admin.add(session, input);
    }),

    pluginRemove: builder.pluginRemove.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const admin = yield* PluginAdminService;
      return yield* admin.remove(session, input);
    }),

    pluginList: builder.pluginList.effect(function* () {
      const session = yield* ResolutionSessionService;
      const admin = yield* PluginAdminService;
      const plugins = yield* admin.list(session);
      return {
        status: "listed" as const,
        plugins,
      };
    }),

    pluginPublish: builder.pluginPublish.effect(function* (_opts, input) {
      const session = yield* ResolutionSessionService;
      const admin = yield* PluginAdminService;
      return yield* admin.publish(session, input);
    }),
  };
}
