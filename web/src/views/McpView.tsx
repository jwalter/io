import { useState, useEffect } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import { Plus, Trash2, Server } from "lucide-react";

interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export default function McpView() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  useEffect(() => {
    apiGet<McpServer[]>("/mcp").then((data) => { setServers(data); setLoading(false); });
  }, []);

  const addServer = async () => {
    if (!newName || !newUrl) return;
    const server = await apiPost<McpServer>("/mcp", { name: newName, url: newUrl });
    setServers((prev) => [...prev, server]);
    setNewName("");
    setNewUrl("");
    setShowAdd(false);
  };

  const toggleServer = async (id: string, enabled: boolean) => {
    await apiPut(`/mcp/${id}`, { enabled });
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  };

  const deleteServer = async (id: string) => {
    await apiDelete(`/mcp/${id}`);
    setServers((prev) => prev.filter((s) => s.id !== id));
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">MCP Servers</h1>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm">
          <Plus size={16} /> Add
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-4 border border-border rounded-lg space-y-3">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Server name" className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Server URL" className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <div className="flex gap-2">
            <button onClick={addServer} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm">Add Server</button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm">Cancel</button>
          </div>
        </div>
      )}

      {servers.length === 0 ? (
        <p className="text-muted-foreground">No MCP servers configured</p>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <div key={server.id} className="flex items-center gap-4 p-4 border border-border rounded-lg">
              <Server size={20} className="text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium text-sm">{server.name}</p>
                <p className="text-xs text-muted-foreground">{server.url}</p>
              </div>
              <ToggleSwitch checked={server.enabled} onChange={(checked) => toggleServer(server.id, checked)} />
              <button onClick={() => deleteServer(server.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
