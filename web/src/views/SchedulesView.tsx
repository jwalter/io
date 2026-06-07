import { useState, useEffect } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import { describeCron } from "@/lib/cron";
import { Plus, Trash2, Play, Pencil, Check, X } from "lucide-react";

interface Schedule {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  type: "io" | "squad";
  squadId?: string;
}

interface Squad {
  id: string;
  name: string;
}

export default function SchedulesView() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [tab, setTab] = useState<"io" | "squad">("io");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newSchedule, setNewSchedule] = useState({ name: "", prompt: "", cron: "", squadId: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [triggeredId, setTriggeredId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiGet<Schedule[]>("/schedules"), apiGet<Squad[]>("/squads")]).then(([s, sq]) => {
      setSchedules(s);
      setSquads(sq);
      setLoading(false);
    });
  }, []);

  const filtered = schedules.filter((s) => s.type === tab);

  const addSchedule = async () => {
    const body = { ...newSchedule, type: tab, ...(tab === "squad" ? { squadId: newSchedule.squadId } : {}) };
    const schedule = await apiPost<Schedule>("/schedules", body);
    setSchedules((prev) => [...prev, schedule]);
    setNewSchedule({ name: "", prompt: "", cron: "", squadId: "" });
    setShowAdd(false);
  };

  const toggleSchedule = async (id: string, enabled: boolean) => {
    await apiPut(`/schedules/${id}`, { enabled });
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  };

  const deleteSchedule = async (id: string) => {
    await apiDelete(`/schedules/${id}`);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  const triggerNow = async (id: string) => {
    await apiPost(`/schedules/${id}/trigger`);
    setTriggeredId(id);
    setTimeout(() => setTriggeredId(null), 2000);
  };

  const savePrompt = async (id: string) => {
    await apiPut(`/schedules/${id}`, { prompt: editPrompt });
    setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, prompt: editPrompt } : s)));
    setEditingId(null);
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Schedules</h1>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm">
          <Plus size={16} /> Add
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {(["io", "squad"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-sm rounded-md ${tab === t ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}>
            {t === "io" ? "IO" : "Squad"}
          </button>
        ))}
      </div>

      {showAdd && (
        <div className="mb-4 p-4 border border-border rounded-lg space-y-3">
          <input value={newSchedule.name} onChange={(e) => setNewSchedule({ ...newSchedule, name: e.target.value })} placeholder="Name" className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <textarea value={newSchedule.prompt} onChange={(e) => setNewSchedule({ ...newSchedule, prompt: e.target.value })} placeholder="Prompt" rows={3} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          <input value={newSchedule.cron} onChange={(e) => setNewSchedule({ ...newSchedule, cron: e.target.value })} placeholder="Cron expression (e.g. */5 * * * *)" className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          {tab === "squad" && (
            <select value={newSchedule.squadId} onChange={(e) => setNewSchedule({ ...newSchedule, squadId: e.target.value })} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">Select squad</option>
              {squads.map((sq) => <option key={sq.id} value={sq.id}>{sq.name}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <button onClick={addSchedule} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm">Create</button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((schedule) => (
          <div key={schedule.id} className="p-4 border border-border rounded-lg">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="font-medium text-sm">{schedule.name}</p>
                <p className="text-xs text-muted-foreground">{describeCron(schedule.cron)}</p>
              </div>
              <ToggleSwitch checked={schedule.enabled} onChange={(checked) => toggleSchedule(schedule.id, checked)} />
              <button onClick={() => triggerNow(schedule.id)} className={`text-sm ${triggeredId === schedule.id ? "text-green-400" : "text-muted-foreground hover:text-foreground"}`} title="Trigger now">
                <Play size={16} />
              </button>
              <button onClick={() => { setEditingId(schedule.id); setEditPrompt(schedule.prompt); }} className="text-muted-foreground hover:text-foreground">
                <Pencil size={14} />
              </button>
              <button onClick={() => deleteSchedule(schedule.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 size={16} />
              </button>
            </div>
            {editingId === schedule.id && (
              <div className="mt-3 flex gap-2">
                <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} rows={2} className="flex-1 px-3 py-2 bg-input border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={() => savePrompt(schedule.id)} className="text-green-400 hover:text-green-300"><Check size={18} /></button>
                <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground">No {tab} schedules</p>}
      </div>
    </div>
  );
}
