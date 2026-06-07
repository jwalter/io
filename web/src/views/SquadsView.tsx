import { useState, useEffect } from "react";
import { Link } from "react-router";
import { apiGet } from "@/lib/api";
import { getSquadLabelStyle } from "@/lib/squad-colors";
import { Users } from "lucide-react";

interface Squad {
  id: string;
  name: string;
  description?: string;
  color?: string;
  agentCount: number;
  instanceCount: number;
}

export default function SquadsView() {
  const [squads, setSquads] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Squad[]>("/squads").then((data) => { setSquads(data); setLoading(false); });
  }, []);

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Squads</h1>
        <Link to="/squads/health" className="text-sm text-primary hover:underline">Health Dashboard →</Link>
      </div>
      {squads.length === 0 ? (
        <p className="text-muted-foreground">No squads configured</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {squads.map((squad) => (
            <Link key={squad.id} to={`/squads/${squad.id}`} className="block p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors">
              <div className="flex items-center gap-3 mb-2">
                <span className="px-2 py-0.5 rounded text-xs font-medium" style={getSquadLabelStyle(squad.color)}>
                  {squad.name}
                </span>
              </div>
              {squad.description && <p className="text-sm text-muted-foreground mb-3">{squad.description}</p>}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Users size={12} /> {squad.agentCount} agents</span>
                <span>{squad.instanceCount} instances</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
