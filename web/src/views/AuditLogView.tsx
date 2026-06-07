import { useState, useEffect } from "react";
import { apiGet } from "@/lib/api";

interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  target?: string;
  details?: string;
  timestamp: string;
}

export default function AuditLogView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<AuditEntry[]>("/audit-log").then((data) => { setEntries(data); setLoading(false); });
  }, []);

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Audit Log</h1>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">No audit entries</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Time</th>
                <th className="text-left px-4 py-2 font-medium">Action</th>
                <th className="text-left px-4 py-2 font-medium">Actor</th>
                <th className="text-left px-4 py-2 font-medium">Target</th>
                <th className="text-left px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-border">
                  <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="px-4 py-2 font-medium">{entry.action}</td>
                  <td className="px-4 py-2">{entry.actor}</td>
                  <td className="px-4 py-2 text-muted-foreground">{entry.target ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{entry.details ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
