import { useState, useRef, useEffect, type KeyboardEvent, type DragEvent } from "react";
import { useChatStore } from "@/stores/chat";
import { useAuthStore } from "@/stores/auth";
import { MarkdownContent } from "./MarkdownContent";
import {
  fileToMessageAttachment,
  validateAttachmentSizes,
  formatAttachmentSize,
  isImageAttachment,
  toDataUrl,
  type MessageAttachment,
} from "@/lib/attachments";
import { MessageSquare, X, Send, Paperclip, Square, Trash2 } from "lucide-react";

export function ChatOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [composerError, setComposerError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const email = useAuthStore((s) => s.email);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
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

  const userInitial = email ? email[0].toUpperCase() : "U";

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full btn-gradient text-white flex items-center justify-center shadow-glow-lg z-50 hover:scale-105 transition-transform"
      >
        <MessageSquare size={24} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 w-96 h-[70vh] max-h-[700px] bg-card border-l border-t border-border rounded-tl-lg shadow-glow-lg z-50 flex flex-col"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-tl-lg z-10 flex items-center justify-center">
          <p className="text-primary font-medium">Drop files here</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-medium">
            {userInitial}
          </div>
          <span className="text-sm font-medium">Chat</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={clearMessages} className="text-muted-foreground hover:text-foreground p-1" title="Clear">
            <Trash2 size={14} />
          </button>
          <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}>
              {msg.role === "assistant" ? (
                <MarkdownContent content={msg.content || (msg.streaming ? "..." : "")} className="text-sm" />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              {msg.attachments.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {msg.attachments.map((att, i) => (
                    <span key={i} className="text-xs px-1.5 py-0.5 bg-black/20 rounded">
                      {isImageAttachment(att) ? (
                        <img src={toDataUrl(att)} alt={att.name} className="max-w-20 max-h-20 rounded" />
                      ) : (
                        <>{att.name} ({formatAttachmentSize(att.size)})</>
                      )}
                    </span>
                  ))}
                </div>
              )}
              {msg.streaming && (
                <span className="inline-flex gap-0.5 ml-1">
                  <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        {composerError && <p className="text-xs text-destructive mb-1">{composerError}</p>}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {pendingAttachments.map((att, i) => (
              <div key={i} className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-muted rounded">
                <span className="truncate max-w-20">{att.name}</span>
                <button onClick={() => removeAttachment(i)} className="text-muted-foreground hover:text-foreground"><X size={10} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="cursor-pointer text-muted-foreground hover:text-foreground self-end pb-1">
            <Paperclip size={16} />
            <input type="file" multiple className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          </label>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            rows={1}
            className="flex-1 resize-none bg-input border border-border rounded-md px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {isStreaming ? (
            <button onClick={stopStreaming} className="p-1.5 bg-destructive text-destructive-foreground rounded">
              <Square size={14} />
            </button>
          ) : (
            <button onClick={handleSend} className="p-1.5 btn-gradient text-white rounded">
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
