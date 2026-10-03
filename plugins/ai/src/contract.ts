import "@orpc/openapi/extensions/route";
import { eventIterator, oc } from "@orpc/contract";
import type {
  CustomEvent,
  KnownCustomEvent,
  MessagePart,
  StreamChunk,
  UIMessage,
} from "@tanstack/ai";
import { z } from "zod";

export type ChatStreamChunk = Exclude<StreamChunk, CustomEvent> | KnownCustomEvent;

export const ChatMessageSchema: z.ZodType<UIMessage> = z.looseObject({
  id: z.string().min(1).describe("Unique message id"),
  role: z.enum(["system", "user", "assistant"]).describe("Message role"),
  parts: z.array(z.custom<MessagePart>()).describe("Message content parts"),
  name: z.string().optional().describe("Optional AG-UI sender name"),
  createdAt: z.coerce.date().optional().describe("Creation timestamp"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Optional metadata bag"),
});

export const ChatInputSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).describe("Full UIMessage conversation history"),
});

export const ChatChunkSchema = z.custom<ChatStreamChunk>();

export const contract = oc.router({
  chat: oc
    .route({
      method: "POST",
      path: "/chat",
      summary: "Stream a chat completion",
      description:
        "Streams a chat completion from the configured OpenAI-compatible endpoint as AG-UI protocol events. Requires authentication.",
      tags: ["AI"],
    })
    .input(ChatInputSchema)
    .output(eventIterator(ChatChunkSchema))
    .errors({
      UNAUTHORIZED: {
        message: "Authentication required",
      },
    }),
});

export type ContractType = typeof contract;
