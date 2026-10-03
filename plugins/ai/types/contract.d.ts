import "@orpc/openapi/extensions/route";
import type { CustomEvent, KnownCustomEvent, StreamChunk, UIMessage } from "@tanstack/ai";
import { z } from "zod";
export type ChatStreamChunk = Exclude<StreamChunk, CustomEvent> | KnownCustomEvent;
export declare const ChatMessageSchema: z.ZodType<UIMessage>;
export declare const ChatInputSchema: z.ZodObject<{
    messages: z.ZodArray<z.ZodType<UIMessage<unknown>, unknown, z.core.$ZodTypeInternals<UIMessage<unknown>, unknown>>>;
}, z.core.$strip>;
export declare const ChatChunkSchema: z.ZodCustom<ChatStreamChunk, ChatStreamChunk>;
export declare const contract: {
    chat: import("@orpc/contract").ProcedureContract<z.ZodObject<{
        messages: z.ZodArray<z.ZodType<UIMessage<unknown>, unknown, z.core.$ZodTypeInternals<UIMessage<unknown>, unknown>>>;
    }, z.core.$strip>, import("@orpc/contract").Schema<AsyncIteratorObject<ChatStreamChunk, unknown, void>, import("@standard-server/shared").AsyncIteratorClass<ChatStreamChunk, unknown, void>>, {
        UNAUTHORIZED: {
            message: string;
        };
    }>;
};
export type ContractType = typeof contract;
