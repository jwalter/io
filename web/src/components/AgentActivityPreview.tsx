import { useState, useEffect, useRef } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { MarkdownContent } from "./MarkdownContent";
import { useAuthStore } from "@/stores/auth";
import { X, Square, Code, FileText } from "lucide-react";

interface TaskEvent {
  type: string;
  content: string;
  timestamp: string;
}

interface AgentActivityPreviewProps {
  taskId: string;
  onClose: () => void;
}

export function AgentActivityPreview({ taskId, onClose }: AgentActivityPreviewProps) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [liveMessage, setLiveMessage] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const [stopping, setStopping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    // Load existing events
    apiGet<TaskEvent[]>(`/tasks/${taskId}/events`).then(setEvents);

    // Connect SSE
    const url = `/api/stream?token=${token ?? ""}&taskId=${taskId}`;
    const es = new EventSource(url);

    es.addEventListener("task-delta", (e) => {
      const data = JSON.parse(e.data);
      setLiveMessage(data.content ?? "");
    });

    es.addEventListener("task-event", (e) => {
      const data = JSON.parse(e.data);
      setEvents((prev) => [...prev, data]);
      setLiveMessage("");
    });

    es.addEventListener("task-done", () => {
      es.close();
    });

    return () => es.close();
  }, [taskId, token]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [events, liveMessage]);

  const stop = async () => {
    setStopping(true);
    await apiPost(`/tasks/${taskId}/stop`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-3xl h-[80vh] bg-card border border-border rounded-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-medium text-sm">Task Activity</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setRawMode(!rawMode)} className="text-muted-foreground hover:text-foreground" title={rawMode ? "Pretty" : "Raw"}>
              {rawMode ? <FileText size={16} /> : <Code size={16} />}
            </button>
            <button onClick={stop} disabled={stopping} className="text-muted-foreground hover:text-destructive disabled:opacity-50" title="Stop">
              <Square size={16} />
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {events.map((ev, i) => (
            <div key={i} className="text-sm">
              {rawMode ? (
                <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">{JSON.stringify(ev, null, 2)}</pre>
              ) : (
                <div className="flex gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">{ev.type}</span>
                  <MarkdownContent content={ev.content} className="text-sm" />
                </div>
              )}
            </div>
          ))}
          {liveMessage && (
            <div className="text-sm">
              {rawMode ? (
                <pre className="text-xs text-muted-foreground font-mono">{liveMessage}</pre>
              ) : (
                <MarkdownContent content={liveMessage} className="text-sm" />
              )}
              <span className="inline-flex gap-1 ml-1">
                <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
