import { useState, useRef, useEffect, type KeyboardEvent, type DragEvent } from "react";
import { useChatStore } from "@/stores/chat";
import { MarkdownContent } from "@/components/MarkdownContent";
import {
  fileToMessageAttachment,
  validateAttachmentSizes,
  formatAttachmentSize,
  isImageAttachment,
  toDataUrl,
  type MessageAttachment,
} from "@/lib/attachments";
import { Paperclip, Send, X } from "lucide-react";

export default function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);

  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [composerError, setComposerError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    setInput("");
    setComposerError("");
    const attachments = [...pendingAttachments];
    setPendingAttachments([]);
    await sendMessage(trimmed, attachments);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const results: MessageAttachment[] = [];
    for (const file of Array.from(files)) {
      results.push(await fileToMessageAttachment(file));
    }
    const all = [...pendingAttachments, ...results];
    const validation = validateAttachmentSizes(all);
    if (!validation.ok) {
      setComposerError(validation.error);
      return;
    }
    setPendingAttachments(all);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const removeAttachment = (index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg z-50 flex items-center justify-center">
          <p className="text-primary font-medium">Drop files here</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Start a conversation...</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-4 py-3 ${
                msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border"
              }`}
            >
              {msg.role === "assistant" ? (
                <MarkdownContent content={msg.content || (msg.streaming ? "..." : "")} />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              {msg.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {msg.attachments.map((att, i) => (
                    <div key={i} className="text-xs px-2 py-1 bg-muted rounded">
                      {isImageAttachment(att) ? (
                        <img src={toDataUrl(att)} alt={att.name} className="max-w-32 max-h-32 rounded" />
                      ) : (
                        <span>{att.name} ({formatAttachmentSize(att.size)})</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {msg.streaming && (
                <span className="inline-flex gap-1 ml-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border p-4">
        {composerError && <p className="text-xs text-destructive mb-2">{composerError}</p>}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingAttachments.map((att, i) => (
              <div key={i} className="flex items-center gap-1 text-xs px-2 py-1 bg-muted rounded">
                <span>{att.name}</span>
                <button onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="cursor-pointer text-muted-foreground hover:text-foreground self-end pb-2">
            <Paperclip size={20} />
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </label>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 resize-none bg-input border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {isStreaming ? (
            <button onClick={stopStreaming} className="px-3 py-2 bg-destructive text-destructive-foreground rounded-md text-sm">
              Stop
            </button>
          ) : (
            <button onClick={handleSend} className="px-3 py-2 btn-gradient text-white rounded-md">
              <Send size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
