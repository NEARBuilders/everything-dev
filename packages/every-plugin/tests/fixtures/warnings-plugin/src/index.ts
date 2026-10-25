import { Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import type { PluginWarningInfo } from "every-plugin/errors";
import { z } from "zod";
import { warningsContract } from "./contract";

export const WarningsPlugin = createPlugin({
  variables: z.object({
    provider: z.string().optional(),
  }),
  secrets: z.object({
    OPTIONAL_TOKEN: z.string().optional(),
  }),
  contract: warningsContract,
  warnings: (config): PluginWarningInfo[] | string[] => {
    if (config.variables.provider === "throw") {
      throw new Error("boom");
    }
    if (config.variables.provider === "structured") {
      return [{ pluginKey: "ignored", message: "structured message", hint: "do a thing" }];
    }
    if (config.secrets.OPTIONAL_TOKEN) return [];
    return ["OPTIONAL_TOKEN is not set"];
  },
  initialize: () => Effect.succeed(Layer.empty as never),
  createRouter: (builder) => ({
    ping: builder.ping.handler(async () => ({ ok: true })),
  }),
});
