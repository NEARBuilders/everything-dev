import { ORPCError } from "every-plugin/orpc";
import type { Thing, ThingEvent } from "../contract";
import type { Context } from "../lib/context";
import type { PluginsClient } from "../lib/plugins-types.gen";

export type ThingProviderResult = {
  type: string;
  payload: unknown;
  action?: string;
};

export type ThingProvider = {
  create: (
    plugins: Omit<PluginsClient, "auth">,
    input: { thingId: string; payload: unknown },
    context: Context,
  ) => Promise<ThingProviderResult>;
  get: (
    plugins: Omit<PluginsClient, "auth">,
    input: { thingId: string },
    context: Context,
  ) => Promise<ThingProviderResult>;
  delete?: (
    plugins: Omit<PluginsClient, "auth">,
    input: { thingId: string },
    context: Context,
  ) => Promise<void>;
};

export function generateThingId(): string {
  return `thing_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function getThingProvider(pluginId: string): ThingProvider | null {
  const providers: Record<string, ThingProvider> = {
    template: buildPluginThingProvider("template"),
  };

  return providers[pluginId] ?? null;
}

function buildPluginThingProvider(pluginId: string): ThingProvider {
  const getClient = (pluginClients: Omit<PluginsClient, "auth">, context: Context) =>
    (pluginClients as Record<string, any>)[pluginId]!(context);
  return {
    create: async (pluginClients, input, context) =>
      await getClient(pluginClients, context).createThing(input),
    get: async (pluginClients, input, context) =>
      await getClient(pluginClients, context).getThing(input),
    delete: async (pluginClients, input, context) => {
      await getClient(pluginClients, context).deleteThing(input);
    },
  };
}

export function toThingOutput(
  input: {
    thingId: string;
    pluginId: string;
    createdAt: string;
    updatedAt: string;
  },
  providerResult: ThingProviderResult,
): Thing {
  return {
    thingId: input.thingId,
    pluginId: input.pluginId,
    type: providerResult.type,
    payload: providerResult.payload,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function toThingEvent(input: {
  thingId: string;
  pluginId: string;
  type: string;
  action: string;
  userId?: string;
  totalCount?: number;
}): ThingEvent {
  return {
    thingId: input.thingId,
    pluginId: input.pluginId,
    type: input.type,
    action: input.action,
    userId: input.userId,
    totalCount: input.totalCount,
    timestamp: new Date().toISOString(),
  };
}

export function unsupportedPluginError(pluginId: string) {
  return new ORPCError("BAD_REQUEST", {
    message: `Unsupported pluginId: ${pluginId}`,
  });
}
