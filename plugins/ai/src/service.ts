import type { AnyTextAdapter, ChatStream, UIMessage } from "@tanstack/ai";
import { chat } from "@tanstack/ai";

export class AiChatService {
  constructor(
    private readonly adapter: AnyTextAdapter,
    private readonly systemPrompts: string[],
  ) {}

  stream(messages: UIMessage[], signal?: AbortSignal): ChatStream {
    const abortController = new AbortController();
    signal?.addEventListener("abort", () => abortController.abort(), { once: true });

    return chat({
      adapter: this.adapter,
      systemPrompts: this.systemPrompts,
      messages,
      abortController,
    });
  }
}
