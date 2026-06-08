import { create } from "zustand";
import type { MessageAttachment } from "@/lib/attachments";
import { notifyError } from "@/lib/notify";
import { useAuthStore } from "./auth";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: MessageAttachment[];
  timestamp: Date;
  streaming?: boolean;
}

const NEW_BUBBLE_THRESHOLD = 5_000;

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 <= Date.now() + 60_000;
  } catch {
    return true;
  }
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  conversationId: string;
  sendMessage: (content: string, attachments?: MessageAttachment[]) => Promise<void>;
  stopStreaming: () => void;
  clearMessages: () => void;
}

let currentAbortController: AbortController | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  conversationId: crypto.randomUUID(),

  async sendMessage(content: string, attachments: MessageAttachment[] = []) {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      attachments,
      timestamp: new Date(),
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      attachments: [],
      timestamp: new Date(),
      streaming: true,
    };

    set((state) => ({
      messages: [...state.messages, userMsg, assistantMsg],
      isStreaming: true,
    }));

    let lastDeltaTime = Date.now();

    try {
      const auth = useAuthStore.getState();
      if (auth.token && isTokenExpired(auth.token)) {
        await auth.refreshToken();
      }

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const currentToken = useAuthStore.getState().token;
      if (currentToken) {
        headers["Authorization"] = `Bearer ${currentToken}`;
      }

      currentAbortController = new AbortController();

      const response = await fetch("/api/message", {
        method: "POST",
        headers,
        signal: currentAbortController.signal,
        body: JSON.stringify({
          prompt: content,
          conversationId: get().conversationId,
          attachments,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`API error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (currentEvent === "delta") {
                const now = Date.now();
                set((state) => {
                  const msgs = [...state.messages];
                  const lastMsg = msgs[msgs.length - 1];
                  if (
                    lastMsg &&
                    !lastMsg.streaming &&
                    lastMsg.role === "assistant" &&
                    now - lastDeltaTime > NEW_BUBBLE_THRESHOLD
                  ) {
                    msgs.push({
                      id: crypto.randomUUID(),
                      role: "assistant",
                      content: parsed.content,
                      attachments: [],
                      timestamp: new Date(),
                      streaming: true,
                    });
                  } else {
                    const streamingMsgs = msgs.filter((m) => m.streaming);
                    const target = streamingMsgs[streamingMsgs.length - 1];
                    if (target) {
                      target.content = parsed.content;
                    }
                  }
                  return { messages: msgs };
                });
                lastDeltaTime = now;
              } else if (currentEvent === "done") {
                set((state) => {
                  const msgs = [...state.messages];
                  const streamingMsgs = msgs.filter((m) => m.streaming);
                  const target = streamingMsgs[streamingMsgs.length - 1];
                  if (target) {
                    target.content = parsed.content;
                    target.streaming = false;
                  }
                  return {
                    messages: msgs,
                    conversationId: parsed.conversationId ?? state.conversationId,
                  };
                });
              } else if (currentEvent === "error") {
                set((state) => {
                  const msgs = [...state.messages];
                  const streamingMsgs = msgs.filter((m) => m.streaming);
                  const target = streamingMsgs[streamingMsgs.length - 1];
                  if (target) {
                    target.content = `Error: ${parsed.error}`;
                    target.streaming = false;
                  }
                  return { messages: msgs };
                });
                notifyError(
                  typeof parsed.error === "string" && parsed.error.trim()
                    ? parsed.error
                    : "Streaming request failed"
                );
              }
            } catch {
              // Ignore malformed JSON
            }
            currentEvent = "";
          }
        }
      }
    } catch (err: unknown) {
      set((state) => {
        const msgs = [...state.messages];
        const streamingMsgs = msgs.filter((m) => m.streaming);
        const target = streamingMsgs[streamingMsgs.length - 1];
        if (target) {
          if (err instanceof Error && err.name === "AbortError") {
            target.streaming = false;
          } else {
            target.content = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
            target.streaming = false;
          }
        }
        return { messages: msgs };
      });
      if (!(err instanceof Error && err.name === "AbortError")) {
        notifyError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      currentAbortController = null;
      set({ isStreaming: false });
    }
  },

  stopStreaming() {
    currentAbortController?.abort();
  },

  clearMessages() {
    set({ messages: [], conversationId: crypto.randomUUID() });
  },
}));
