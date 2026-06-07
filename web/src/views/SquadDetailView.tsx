import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { AgentActivityPreview } from "@/components/AgentActivityPreview";
import { getSquadLabelStyle } from "@/lib/squad-colors";
import { Square, Trash2, Eye } from "lucide-react";

interface Agent { id: string; name: string; role: string; }
interface Instance { id: string; agentId: string; agentName: string; status: string; startedAt: string; }
interface Task { id: string; description: string; status: string; agentName: string; createdAt: string; }
interface SquadDetail { id: string; name: string; description?: string; color?: string; }

export default function SquadDetailView() {
  const { id } = useParams<{ id: string }>();
  const [squad, setSquad] = useState<SquadDetail | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewTaskId, setPreviewTaskId] = useState<string | null>(null);
  const [stoppingTaskId, setStoppingTaskId] = useState<string | null>(null);
  const [destroyingId, setDestroyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiGet<{ squad: SquadDetail; agents: Agent[]; instances: Instance[]; tasks: Task[] }>(`/squads/${id}`).then((data) => {
      setSquad(data.squad);
      setAgents(data.agents);
      setInstances(data.instances);
      setTasks(data.tasks);
      setLoading(false);
    });
  }, [id]);

  const stopTask = async (taskId: string) => {
    setStoppingTaskId(taskId);
    await apiPost(`/tasks/${taskId}/stop`);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: "stopped" } : t)));
    setStoppingTaskId(null);
  };

  const destroyInstance = async (instanceId: string) => {
    setDestroyingId(instanceId);
    await apiDelete(`/instances/${instanceId}`);
    setInstances((prev) => prev.filter((i) => i.id !== instanceId));
    setDestroyingId(null);
  };

  if (loading || !squad) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {previewTaskId && (
        <AgentActivityPreview
          taskId={previewTaskId}
          onClose={() => setPreviewTaskId(null)}
        />
      )}

      <div className="flex items-center gap-3 mb-6">
        <span className="px-2 py-0.5 rounded text-xs font-medium" style={getSquadLabelStyle(squad.color)}>
          {squad.name}
        </span>
        {squad.description && <span className="text-sm text-muted-foreground">{squad.description}</span>}
      </div>

      {/* Roster */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Roster</h2>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Name</th>
                <th className="text-left px-4 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-t border-border">
                  <td className="px-4 py-2">{agent.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{agent.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Instances */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3">Active Instances</h2>
        {instances.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active instances</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {instances.map((inst) => (
              <div key={inst.id} className="p-3 border border-border rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{inst.agentName}</p>
                    <p className="text-xs text-muted-foreground">{inst.status} · Started {new Date(inst.startedAt).toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => destroyInstance(inst.id)}
                    disabled={destroyingId === inst.id}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tasks */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Recent Tasks</h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3 p-3 border border-border rounded-lg">
                <div className="flex-1">
                  <p className="text-sm">{task.description}</p>
                  <p className="text-xs text-muted-foreground">{task.agentName} · {task.status} · {new Date(task.createdAt).toLocaleString()}</p>
                </div>
                <button onClick={() => setPreviewTaskId(task.id)} className="text-muted-foreground hover:text-foreground" title="View activity">
                  <Eye size={16} />
                </button>
                {task.status === "running" && (
                  <button onClick={() => stopTask(task.id)} disabled={stoppingTaskId === task.id} className="text-muted-foreground hover:text-destructive disabled:opacity-50" title="Stop">
                    <Square size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
