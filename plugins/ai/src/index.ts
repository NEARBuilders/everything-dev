import { ORPCError } from "@orpc/server";
import type { AnyTextAdapter } from "@tanstack/ai";
import { openaiCompatibleText } from "@tanstack/ai-openai/compatible";
import { Context, Effect, Layer } from "effect";
import { createPlugin } from "every-plugin";
import { z } from "zod";
import { contract } from "./contract";
import { AiChatService } from "./service";

class ChatServiceTag extends Context.Service<ChatServiceTag, AiChatService>()("ai/ChatService") {}

/**
 * AI Plugin — OpenAI-compatible chat streaming via oRPC + TanStack AI.
 *
 * The endpoint (baseURL + model) is operator-configured through plugin
 * variables and the API key through secrets, so any Chat Completions
 * compatible provider works (OpenAI, OpenRouter, Groq, Ollama, vLLM, ...).
 *
 * Streaming handlers are plain async generators (not `.effect()`) — service
 * access goes through `Context.get(context["effect/context"], Tag)`.
 */
export default createPlugin({
  variables: z.object({
    baseUrl: z.url().default("https://api.openai.com/v1").describe("OpenAI-compatible base URL"),
    model: z.string().min(1).default("gpt-4o-mini").describe("Model id understood by the endpoint"),
    systemPrompt: z.string().optional().describe("Optional system prompt prepended to every chat"),
  }),

  secrets: z.object({
    AI_API_KEY: z
      .string()
      .min(1)
      .default("sk-dev-placeholder")
      .describe("API key for the OpenAI-compatible endpoint"),
  }),

  contract,

  initialize: (config) => {
    const adapter: AnyTextAdapter = openaiCompatibleText(config.variables.model, {
      baseURL: config.variables.baseUrl,
      apiKey: config.secrets.AI_API_KEY,
    });

    const service = new AiChatService(
      adapter,
      config.variables.systemPrompt ? [config.variables.systemPrompt] : [],
    );

    return Effect.succeed(Layer.succeed(ChatServiceTag, service));
  },

  createRouter: (builder) => {
    return {
      chat: builder.chat.handler(async function* ({ input, context, signal }) {
        if (!context.userId) {
          throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" });
        }

        const service = Context.get(context["effect/context"], ChatServiceTag);

        for await (const chunk of service.stream(input.messages, signal)) {
          yield chunk;
        }
      }),
    };
  },
});
