import { useState, useRef, useEffect, type KeyboardEvent, type DragEvent } from "react";
import { useChatStore } from "@/stores/chat";
import { IoMark } from "@/components/IoMark";
import { MarkdownRenderer } from "@/components/ui";
import {
  fileToMessageAttachment,
  validateAttachmentSizes,
  formatAttachmentSize,
  isImageAttachment,
  toDataUrl,
  type MessageAttachment,
} from "@/lib/attachments";
import { Paperclip, Send, Square, X } from "lucide-react";

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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
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
    const newAttachments: MessageAttachment[] = [];
    for (const file of Array.from(files)) {
      newAttachments.push(await fileToMessageAttachment(file));
    }
    const combined = [...pendingAttachments, ...newAttachments];
    const validated = validateAttachmentSizes(combined);
    if (!validated.ok) {
      setComposerError(validated.error);
      return;
    }
    setPendingAttachments(combined);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <IoMark height={48} />
            <p className="text-zinc-600 font-mono text-sm">Start a conversation with IO</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-mono mt-0.5 ${msg.role === "user" ? "border border-[#66FCF1]/30 text-[#66FCF1]" : "bg-[#282828] border border-white/[0.07] text-zinc-500"}`}
              style={msg.role === "user" ? { background: "rgba(69,162,158,0.12)" } : undefined}
            >
              {msg.role === "user" ? "U" : <IoMark height={12} />}
            </div>
            <div className={`flex flex-col gap-1.5 max-w-[72%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div
                className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${msg.role === "user" ? "text-[#1F2833] rounded-tr-sm" : "bg-[#222222] border border-white/[0.07] text-zinc-200 rounded-tl-sm"}`}
                style={msg.role === "user" ? { background: "linear-gradient(135deg, #45A29E 0%, #F75F57 100%)" } : undefined}
              >
                {msg.role === "assistant" ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
              <span className="text-[11px] text-zinc-700 font-mono px-0.5">
                {msg.timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
            </div>
          </div>
        ))}
        {isStreaming && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center bg-[#282828] border border-white/[0.07] mt-0.5">
              <IoMark height={12} />
            </div>
            <div className="bg-[#222222] border border-white/[0.07] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
              {[0, 120, 240].map(d => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-[#66FCF1] animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-white/[0.06] p-4 flex-shrink-0">
        {composerError && (
          <div className="text-[11px] font-mono text-red-400 mb-2">{composerError}</div>
        )}

        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingAttachments.map((att, i) => (
              <div key={i} className="flex items-center gap-2 bg-[#252525] border border-white/[0.08] rounded-xl px-3 py-1.5">
                <span className="text-[10px] font-mono text-zinc-400 truncate max-w-[120px]">{att.name}</span>
                <span className="text-[9px] font-mono text-zinc-600">{formatAttachmentSize(att.size)}</span>
                <button onClick={() => setPendingAttachments(p => p.filter((_, idx) => idx !== i))} className="text-zinc-600 hover:text-zinc-300">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={`bg-[#1e1e1e] border rounded-2xl overflow-hidden transition-colors focus-within:border-[#66FCF1]/30 ${isDragging ? "border-[#66FCF1]/50" : "border-white/[0.08]"}`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message IO…"
            rows={1}
            className="w-full bg-transparent px-4 pt-3 pb-1 text-sm text-zinc-200 placeholder:text-zinc-700 resize-none focus:outline-none"
            style={{ minHeight: "42px", maxHeight: "160px", fontFamily: "Inter, sans-serif" }}
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <button
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.onchange = () => { if (input.files) handleFiles(input.files); };
                input.click();
              }}
              className="p-1.5 rounded-lg hover:bg-white/[0.05] text-zinc-700 hover:text-zinc-400 transition-colors"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              {isStreaming ? (
                <button onClick={stopStreaming} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-zinc-300 transition-colors">
                  <Square className="w-3 h-3" /> Stop
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim() && pendingAttachments.length === 0}
                  className="p-2 rounded-xl text-[#1F2833] disabled:opacity-30 disabled:cursor-not-allowed transition-opacity hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #45A29E, #F75F57)" }}
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="text-center text-[11px] text-zinc-800 font-mono mt-2">IO may make mistakes. Verify important outputs.</p>
      </div>
    </div>
  );
}
