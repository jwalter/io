import { useState, useEffect } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Check, Trash2, ChevronDown, ChevronRight } from "lucide-react";

interface FeedItem {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  squadId?: string;
  squadName?: string;
}

export default function FeedView() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const data = await apiGet<FeedItem[]>(`/feed?unread=${filter === "unread"}`);
      setItems(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchItems(); }, [filter]);

  const markRead = async (id: string) => {
    await apiPost(`/feed/${id}/read`);
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, read: true } : item));
  };

  const deleteItem = async (id: string) => {
    await apiDelete(`/feed/${id}`);
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const toggle = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      const item = items.find((i) => i.id === id);
      if (item && !item.read) markRead(id);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Feed</h1>
      <div className="flex gap-2 mb-4">
        {(["unread", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"
            }`}
          >
            {f === "unread" ? "Unread" : "All"}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">No items</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => toggle(item.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
              >
                {expandedId === item.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className={`flex-1 text-sm ${!item.read ? "font-semibold" : "text-muted-foreground"}`}>
                  {item.title}
                </span>
                {item.squadName && (
                  <span className="text-xs px-2 py-0.5 bg-muted rounded">{item.squadName}</span>
                )}
              </button>
              {expandedId === item.id && (
                <div className="px-4 pb-4 border-t border-border">
                  <div className="pt-3">
                    <MarkdownContent content={item.body} />
                  </div>
                  <div className="flex gap-2 mt-3">
                    {!item.read && (
                      <button onClick={() => markRead(item.id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <Check size={14} /> Mark read
                      </button>
                    )}
                    <button onClick={() => deleteItem(item.id)} className="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80">
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
