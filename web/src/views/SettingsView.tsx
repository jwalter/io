import { useState, useEffect } from "react";
import { apiGet, apiPut } from "@/lib/api";

interface Settings {
  model?: string;
  systemPrompt?: string;
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramAllowedUsers?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

const tabs = ["General", "Telegram", "Auth", "Advanced"] as const;

export default function SettingsView() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("General");

  useEffect(() => {
    apiGet<Settings>("/settings").then((data) => { setSettings(data); setLoading(false); });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await apiPut("/settings", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const update = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      <div className="flex gap-2 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === tab ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {activeTab === "General" && (
          <>
            <Field label="Model">
              <input value={settings.model ?? ""} onChange={(e) => update("model", e.target.value)} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="System Prompt">
              <textarea value={settings.systemPrompt ?? ""} onChange={(e) => update("systemPrompt", e.target.value)} rows={4} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
          </>
        )}
        {activeTab === "Telegram" && (
          <>
            <Field label="Enabled">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!settings.telegramEnabled} onChange={(e) => update("telegramEnabled", e.target.checked)} />
                <span className="text-sm">Enable Telegram bot</span>
              </label>
            </Field>
            <Field label="Bot Token">
              <input type="password" value={settings.telegramBotToken ?? ""} onChange={(e) => update("telegramBotToken", e.target.value)} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Allowed Users (comma-separated)">
              <input value={settings.telegramAllowedUsers ?? ""} onChange={(e) => update("telegramAllowedUsers", e.target.value)} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
          </>
        )}
        {activeTab === "Auth" && (
          <>
            <Field label="Supabase URL">
              <input value={settings.supabaseUrl ?? ""} onChange={(e) => update("supabaseUrl", e.target.value)} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Supabase Anon Key">
              <input type="password" value={settings.supabaseAnonKey ?? ""} onChange={(e) => update("supabaseAnonKey", e.target.value)} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Supabase Service Role Key">
              <input type="password" value={settings.supabaseServiceRoleKey ?? ""} onChange={(e) => update("supabaseServiceRoleKey", e.target.value)} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
          </>
        )}
        {activeTab === "Advanced" && (
          <>
            <Field label="Max Tokens">
              <input type="number" value={settings.maxTokens ?? ""} onChange={(e) => update("maxTokens", Number(e.target.value))} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="Temperature">
              <input type="number" step="0.1" min="0" max="2" value={settings.temperature ?? ""} onChange={(e) => update("temperature", Number(e.target.value))} className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
          </>
        )}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-4 py-2 btn-gradient text-white rounded-md disabled:opacity-50">
          {saving ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-sm text-green-400">Saved!</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}
