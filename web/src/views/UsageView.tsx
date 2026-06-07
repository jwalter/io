import { useState, useEffect } from "react";
import { apiGet } from "@/lib/api";

interface UsageSummary {
  total_records: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
}

interface BySquadEntry { id: string; name: string; total_input_tokens: number; total_output_tokens: number; total_tokens: number; record_count: number; }
interface ByAgentEntry { id: string; name: string; total_input_tokens: number; total_output_tokens: number; total_tokens: number; record_count: number; }
interface DailyEntry { date: string; total_input_tokens: number; total_output_tokens: number; total_tokens: number; }

const tabs = ["Overview", "By Squad", "By Agent", "Daily"] as const;

export default function UsageView() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Overview");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [bySquad, setBySquad] = useState<BySquadEntry[]>([]);
  const [byAgent, setByAgent] = useState<ByAgentEntry[]>([]);
  const [daily, setDaily] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<UsageSummary>("/token-usage/summary"),
      apiGet<BySquadEntry[]>("/token-usage/by-squad"),
      apiGet<ByAgentEntry[]>("/token-usage/by-agent"),
      apiGet<DailyEntry[]>("/token-usage/daily?days=30"),
    ]).then(([s, sq, ag, d]) => {
      setSummary(s);
      setBySquad(sq);
      setByAgent(ag);
      setDaily(d);
      setLoading(false);
    });
  }, []);

  const formatTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  const maxDaily = Math.max(...daily.map((d) => d.total_input_tokens + d.total_output_tokens), 1);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Token Usage</h1>

      <div className="flex gap-2 mb-6">
        {tabs.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-3 py-1.5 text-sm rounded-md ${activeTab === tab ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Overview" && summary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 border border-border rounded-lg">
            <p className="text-xs text-muted-foreground">Input Tokens</p>
            <p className="text-2xl font-bold">{formatTokens(summary.total_input_tokens)}</p>
          </div>
          <div className="p-4 border border-border rounded-lg">
            <p className="text-xs text-muted-foreground">Output Tokens</p>
            <p className="text-2xl font-bold">{formatTokens(summary.total_output_tokens)}</p>
          </div>
          <div className="p-4 border border-border rounded-lg">
            <p className="text-xs text-muted-foreground">Total Tokens</p>
            <p className="text-2xl font-bold">{formatTokens(summary.total_tokens)}</p>
          </div>
        </div>
      )}

      {activeTab === "By Squad" && (
        <Table headers={["Squad", "Input", "Output", "Total"]} rows={bySquad.map((r) => [r.name, formatTokens(r.total_input_tokens), formatTokens(r.total_output_tokens), formatTokens(r.total_tokens)])} />
      )}

      {activeTab === "By Agent" && (
        <Table headers={["Agent", "Input", "Output", "Total"]} rows={byAgent.map((r) => [r.name, formatTokens(r.total_input_tokens), formatTokens(r.total_output_tokens), formatTokens(r.total_tokens)])} />
      )}

      {activeTab === "Daily" && (
        <div>
          <div className="flex items-end gap-1 h-48 mb-4">
            {daily.map((d, i) => {
              const total = d.total_input_tokens + d.total_output_tokens;
              const height = (total / maxDaily) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${d.date}: ${formatTokens(total)} tokens`}>
                  <div className="w-full bg-primary/60 rounded-t" style={{ height: `${height}%` }} />
                </div>
              );
            })}
          </div>
          <Table headers={["Date", "Input", "Output", "Total"]} rows={daily.map((r) => [r.date, formatTokens(r.total_input_tokens), formatTokens(r.total_output_tokens), formatTokens(r.total_tokens)])} />
        </div>
      )}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            {headers.map((h, i) => <th key={i} className="text-left px-4 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {row.map((cell, j) => <td key={j} className="px-4 py-2">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
