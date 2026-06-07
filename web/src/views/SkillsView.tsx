import { useState, useEffect } from "react";
import { apiGet, apiPost, apiDelete, apiPut } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { parseSkillContent, type ParsedSkill } from "@/lib/skill-frontmatter";
import { Plus, Trash2, Search, ExternalLink, Edit, Eye, X } from "lucide-react";

interface Skill {
  slug: string;
  name: string;
  description?: string;
  source?: string;
}

interface DiscoverSkill {
  slug: string;
  name: string;
  description: string;
  source: string;
  url: string;
}

export default function SkillsView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tab, setTab] = useState<"installed" | "discover">("installed");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [installError, setInstallError] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discoverResults, setDiscoverResults] = useState<DiscoverSkill[]>([]);
  const [discoverSource, setDiscoverSource] = useState<"awesome-copilot" | "skillssh">("awesome-copilot");
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewContent, setPreviewContent] = useState<ParsedSkill | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    apiGet<Skill[]>("/skills").then((data) => { setSkills(data); setLoading(false); });
  }, []);

  const installSkill = async () => {
    setInstallError("");
    try {
      const skill = await apiPost<Skill>("/skills", { url: newUrl });
      setSkills((prev) => [...prev, skill]);
      setNewUrl("");
      setShowCreate(false);
    } catch (err: unknown) {
      setInstallError(err instanceof Error ? err.message : "Install failed");
    }
  };

  const removeSkill = async (slug: string) => {
    await apiDelete(`/skills/${slug}`);
    setSkills((prev) => prev.filter((s) => s.slug !== slug));
    if (selectedSkill === slug) setSelectedSkill(null);
  };

  const viewContent = async (slug: string) => {
    setSelectedSkill(slug);
    setEditMode(false);
    const data = await apiGet<{ content: string }>(`/skills/${slug}/content`);
    setSkillContent(data.content);
  };

  const saveContent = async () => {
    if (!selectedSkill) return;
    await apiPut(`/skills/${selectedSkill}/content`, { content: editContent });
    setSkillContent(editContent);
    setEditMode(false);
  };

  const discover = async () => {
    setDiscoverLoading(true);
    try {
      const params = new URLSearchParams({ source: discoverSource });
      if (discoverQuery) params.set("q", discoverQuery);
      const data = await apiGet<DiscoverSkill[]>(`/skills/discover?${params}`);
      setDiscoverResults(data);
    } finally {
      setDiscoverLoading(false);
    }
  };

  useEffect(() => { if (tab === "discover") discover(); }, [tab, discoverSource]);

  const preview = async (url: string) => {
    setPreviewLoading(true);
    setPreviewUrl(url);
    try {
      const data = await apiGet<{ content: string }>(`/skills/preview?url=${encodeURIComponent(url)}`);
      setPreviewContent(parseSkillContent(data.content));
    } finally {
      setPreviewLoading(false);
    }
  };

  const installFromDiscover = async (skill: DiscoverSkill) => {
    const installed = await apiPost<Skill>("/skills", { source: skill.source, slug: skill.slug });
    setSkills((prev) => [...prev, installed]);
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-80 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="flex gap-2 mb-3">
            {(["installed", "discover"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-sm rounded-md ${tab === t ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}>
                {t === "installed" ? "Installed" : "Discover"}
              </button>
            ))}
          </div>
          {tab === "installed" && (
            <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1 text-sm text-primary hover:underline">
              <Plus size={14} /> Install from URL
            </button>
          )}
          {tab === "discover" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <select value={discoverSource} onChange={(e) => setDiscoverSource(e.target.value as typeof discoverSource)} className="px-2 py-1 text-xs bg-input border border-border rounded text-foreground">
                  <option value="awesome-copilot">awesome-copilot</option>
                  <option value="skillssh">skills.sh</option>
                </select>
              </div>
              <div className="flex gap-1">
                <input value={discoverQuery} onChange={(e) => setDiscoverQuery(e.target.value)} placeholder="Search..." className="flex-1 px-2 py-1 text-sm bg-input border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none" />
                <button onClick={discover} className="px-2 py-1 bg-primary text-primary-foreground rounded text-sm"><Search size={14} /></button>
              </div>
            </div>
          )}
        </div>

        {showCreate && tab === "installed" && (
          <div className="p-4 border-b border-border space-y-2">
            <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Git URL or raw file URL" className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            {installError && <p className="text-xs text-destructive">{installError}</p>}
            <div className="flex gap-2">
              <button onClick={installSkill} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm">Install</button>
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {tab === "installed" && skills.map((skill) => (
            <div
              key={skill.slug}
              onClick={() => viewContent(skill.slug)}
              className={`flex items-center gap-2 px-4 py-3 cursor-pointer border-b border-border hover:bg-accent/50 ${selectedSkill === skill.slug ? "bg-accent" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{skill.name || skill.slug}</p>
                {skill.description && <p className="text-xs text-muted-foreground truncate">{skill.description}</p>}
              </div>
              <button onClick={(e) => { e.stopPropagation(); removeSkill(skill.slug); }} className="text-muted-foreground hover:text-destructive">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {tab === "discover" && (
            discoverLoading ? <p className="p-4 text-sm text-muted-foreground">Searching...</p> : (
              discoverResults.map((skill) => (
                <div key={skill.slug} className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-medium">{skill.name}</p>
                  <p className="text-xs text-muted-foreground mb-2">{skill.description}</p>
                  <div className="flex gap-2">
                    <button onClick={() => installFromDiscover(skill)} className="text-xs text-primary hover:underline">Install</button>
                    <button onClick={() => preview(skill.url)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><Eye size={12} /> Preview</button>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {previewContent && (
          <div className="mb-6 p-4 border border-border rounded-lg relative">
            <button onClick={() => setPreviewContent(null)} className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"><X size={16} /></button>
            <h3 className="font-medium mb-2">Preview: {previewUrl}</h3>
            {previewContent.frontmatter.name && <p className="text-sm text-muted-foreground mb-2">{previewContent.frontmatter.description}</p>}
            <MarkdownContent content={previewContent.body} />
          </div>
        )}
        {selectedSkill && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-bold">{selectedSkill}</h2>
              <button onClick={() => { setEditMode(true); setEditContent(skillContent); }} className="text-muted-foreground hover:text-foreground"><Edit size={16} /></button>
            </div>
            {editMode ? (
              <div className="space-y-3">
                <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={20} className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                <div className="flex gap-2">
                  <button onClick={saveContent} className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm">Save</button>
                  <button onClick={() => setEditMode(false)} className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <MarkdownContent content={skillContent} />
            )}
          </div>
        )}
        {!selectedSkill && !previewContent && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a skill to view its content
          </div>
        )}
      </div>
    </div>
  );
}
