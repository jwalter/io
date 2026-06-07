import { useState, useEffect } from "react";
import { apiGet } from "@/lib/api";
import { getSquadLabelStyle } from "@/lib/squad-colors";

interface SquadHealth {
  id: string;
  name: string;
  color?: string;
  status: "active" | "idle" | "stalled";
  activeInstances: number;
  tasksPast24h: number;
  lastActivity?: string;
  recentEvents: { message: string; timestamp: string }[];
}

export default function SquadHealthView() {
  const [health, setHealth] = useState<SquadHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<SquadHealth[]>("/squads/health").then((data) => { setHealth(data); setLoading(false); });
  }, []);

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  const sorted = [...health].sort((a, b) => {
    const order = { stalled: 0, active: 1, idle: 2 };
    return order[a.status] - order[b.status];
  });

  const statusColor = (s: string) => {
    if (s === "active") return "text-green-400";
    if (s === "stalled") return "text-red-400";
    return "text-yellow-400";
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Squad Health</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((squad) => (
          <div key={squad.id} className="p-4 border border-border rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded text-xs font-medium" style={getSquadLabelStyle(squad.color)}>
                {squad.name}
              </span>
              <span className={`text-xs font-medium ${statusColor(squad.status)}`}>{squad.status}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              <div>
                <p className="text-xs text-muted-foreground">Instances</p>
                <p className="font-medium">{squad.activeInstances}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tasks (24h)</p>
                <p className="font-medium">{squad.tasksPast24h}</p>
              </div>
            </div>
            {squad.lastActivity && (
              <p className="text-xs text-muted-foreground mb-2">Last active: {new Date(squad.lastActivity).toLocaleString()}</p>
            )}
            {squad.recentEvents.length > 0 && (
              <div className="border-t border-border pt-2 mt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Recent</p>
                {squad.recentEvents.slice(0, 3).map((ev, i) => (
                  <p key={i} className="text-xs text-muted-foreground truncate">{ev.message}</p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
