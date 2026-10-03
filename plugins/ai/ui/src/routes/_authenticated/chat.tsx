import { ArrowUpIcon, SparkleIcon, StopIcon } from "@phosphor-icons/react";
import { useChat } from "@tanstack/ai-react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { ClientRuntimeConfig } from "everything-dev/types";
import { createPluginApiClient } from "everything-dev/ui/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { contract } from "../../../../src/contract";
import "../../styles.css";

function resolveClientConfig(runtimeConfig?: Partial<ClientRuntimeConfig>): {
  hostUrl: string;
  rpcBase: "/api/rpc";
} {
  return {
    hostUrl:
      runtimeConfig?.hostUrl ?? (typeof window !== "undefined" ? window.location.origin : ""),
    rpcBase: (runtimeConfig?.rpcBase ?? "/api/rpc") as "/api/rpc",
  };
}

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [{ title: "AI Chat" }],
  }),
  staticData: {
    nav: {
      label: "AI Chat",
      icon: "sparkles",
      order: 100,
    },
  },
  component: ChatPage,
});

function ChatPage() {
  const { runtimeConfig } = useRouter().options.context;
  const client = useMemo(
    () => createPluginApiClient<typeof contract>("ai", resolveClientConfig(runtimeConfig)),
    [runtimeConfig?.hostUrl, runtimeConfig?.rpcBase],
  );

  const { messages, sendMessage, isLoading, stop, error } = useChat({
    fetcher: ({ messages: chatMessages }, { signal }) =>
      client.chat({ messages: chatMessages }, { signal }),
  });

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const submit = () => {
    const content = input.trim();
    if (!content || isLoading) return;
    void sendMessage(content);
    setInput("");
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8">
      <header
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground"
        data-testid="chat.heading"
      >
        <SparkleIcon className="size-4" />
        AI Chat
      </header>

      <div className="flex flex-col gap-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <p
              className="max-w-md text-center text-sm text-muted-foreground"
              data-testid="chat.empty"
            >
              Ask anything. Responses stream from the configured OpenAI-compatible endpoint.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "flex flex-col items-end gap-1"
                : "flex flex-col items-start gap-1"
            }
            data-testid={`chat-message-${message.role}`}
          >
            {message.parts.map((part, index) => {
              if (part.type === "text" && part.content) {
                return (
                  <div
                    key={index}
                    className={
                      message.role === "user"
                        ? "max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-base whitespace-pre-wrap text-primary-foreground"
                        : "max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-base whitespace-pre-wrap text-foreground"
                    }
                  >
                    {part.content}
                  </div>
                );
              }
              if (part.type === "thinking" && part.content) {
                return (
                  <div
                    key={index}
                    className="max-w-[80%] rounded-2xl border border-border px-4 py-2 text-sm text-muted-foreground whitespace-pre-wrap italic"
                  >
                    {part.content}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
        {isLoading && (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="chat.loading"
          >
            <Spinner className="size-3" />
            Thinking…
          </div>
        )}
        {error && (
          <div
            className="rounded-2xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
            data-testid="chat.error"
          >
            {error.message || "The chat request failed. Please try again."}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="sticky bottom-0 flex items-end gap-2 bg-background py-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Say something…"
          rows={2}
          disabled={isLoading}
          data-testid="chat-input"
          className="min-h-11"
        />
        {isLoading ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={stop}
            data-testid="chat-stop"
            aria-label="Stop"
          >
            <StopIcon weight="fill" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim()}
            data-testid="chat-send"
            aria-label="Send"
          >
            <ArrowUpIcon weight="bold" />
          </Button>
        )}
      </form>
    </div>
  );
}
