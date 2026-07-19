import { Config, ConfigProvider, Context, Effect } from "every-plugin/effect";
import type {
  ClientRuntimeConfig,
  RuntimeConfig,
  SharedConfig,
  SourceMode,
} from "everything-dev/types";

export type { ClientRuntimeConfig, RuntimeConfig, SharedConfig, SourceMode };

export class ConfigService extends Context.Tag("host/ConfigService")<
  ConfigService,
  RuntimeConfig
>() {}

export function readCorsOrigins(): Effect.Effect<string[]> {
  return Config.array(Config.string(), "CORS_ORIGIN").pipe(
    Effect.map((arr) => arr.filter((s) => s.length > 0)),
    Effect.catchAll(() => Effect.succeed([] as string[])),
    Effect.withConfigProvider(ConfigProvider.fromEnv()),
  );
}
