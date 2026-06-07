import { useState, useEffect, useRef } from "react";
import { apiGet, apiDelete } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Search, Trash2, X } from "lucide-react";

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export default function HistoryView() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchConversations = async (reset = false) => {
    setLoading(true);
    try {
      const p = reset ? 1 : page;
      const params = new URLSearchParams({ page: String(p), limit: "20" });
      if (search) params.set("q", search);
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate);
      const data = await apiGet<{ conversations: Conversation[]; hasMore: boolean }>(`/history?${params}`);
      if (reset) {
        setConversations(data.conversations);
        setPage(1);
      } else {
        setConversations((prev) => [...prev, ...data.conversations]);
      }
      setHasMore(data.hasMore);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchConversations(true), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, startDate, endDate]);

  const loadMore = () => {
    setPage((p) => p + 1);
  };

  useEffect(() => {
    if (page > 1) fetchConversations();
  }, [page]);

  const selectConversation = async (id: string) => {
    setSelectedId(id);
    const data = await apiGet<{ messages: Message[] }>(`/history/${id}`);
    setSelectedMessages(data.messages);
  };

  const deleteConversation = async (id: string) => {
    await apiDelete(`/history/${id}`);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setSelectedMessages([]);
    }
  };

  return (
    <div className="flex h-full">
      {/* Left panel: list */}
      <div className="w-80 border-r border-border flex flex-col">
        <div className="p-4 space-y-3 border-b border-border">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-3 py-2 bg-input border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="flex-1 px-2 py-1 text-xs bg-input border border-border rounded text-foreground" />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="flex-1 px-2 py-1 text-xs bg-input border border-border rounded text-foreground" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => selectConversation(conv.id)}
              className={`flex items-center gap-2 px-4 py-3 cursor-pointer border-b border-border hover:bg-accent/50 transition-colors ${
                selectedId === conv.id ? "bg-accent" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{conv.title}</p>
                <p className="text-xs text-muted-foreground">{new Date(conv.createdAt).toLocaleDateString()} · {conv.messageCount} msgs</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {hasMore && (
            <button onClick={loadMore} className="w-full py-3 text-sm text-primary hover:underline">
              Load more
            </button>
          )}
          {loading && <p className="p-4 text-sm text-muted-foreground">Loading...</p>}
        </div>
      </div>

      {/* Right panel: thread */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedId ? (
          <div className="space-y-4">
            {selectedMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-4 py-3 ${
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border"
                }`}>
                  {msg.role === "assistant" ? (
                    <MarkdownContent content={msg.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a conversation to view
          </div>
        )}
      </div>
    </div>
  );
}
