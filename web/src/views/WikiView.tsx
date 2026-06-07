import { useState, useEffect } from "react";
import { apiGet, apiPut, apiDelete } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { WikiTree } from "@/components/WikiTree";
import { Plus, Edit, Trash2, Save, X, Link2 } from "lucide-react";

interface WikiPage {
  path: string;
  title: string;
}

export default function WikiView() {
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [templates, setTemplates] = useState<WikiPage[]>([]);
  const [mode, setMode] = useState<"pages" | "templates">("pages");
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [backlinks, setBacklinks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewPage, setShowNewPage] = useState(false);
  const [newPagePath, setNewPagePath] = useState("");
  const [search, setSearch] = useState("");

  const fetchPages = async () => {
    const data = await apiGet<WikiPage[]>("/wiki/pages");
    setPages(data);
    const tmpl = await apiGet<WikiPage[]>("/wiki/templates/squad");
    setTemplates(tmpl);
    setLoading(false);
  };

  useEffect(() => { fetchPages(); }, []);

  const selectPage = async (path: string) => {
    setSelectedPage(path);
    setEditMode(false);
    const endpoint = mode === "pages" ? `/wiki/page/${encodeURIComponent(path)}` : `/wiki/template/squad/${encodeURIComponent(path)}`;
    const data = await apiGet<{ content: string }>(endpoint);
    setContent(data.content);
    if (mode === "pages") {
      const bl = await apiGet<string[]>(`/wiki/backlinks/${encodeURIComponent(path)}`);
      setBacklinks(bl);
    } else {
      setBacklinks([]);
    }
  };

  const savePage = async () => {
    if (!selectedPage) return;
    const endpoint = mode === "pages" ? `/wiki/page/${encodeURIComponent(selectedPage)}` : `/wiki/template/squad/${encodeURIComponent(selectedPage)}`;
    await apiPut(endpoint, { content: editContent });
    setContent(editContent);
    setEditMode(false);
  };

  const deletePage = async () => {
    if (!selectedPage) return;
    const endpoint = mode === "pages" ? `/wiki/page/${encodeURIComponent(selectedPage)}` : `/wiki/template/squad/${encodeURIComponent(selectedPage)}`;
    await apiDelete(endpoint);
    setSelectedPage(null);
    setContent("");
    await fetchPages();
  };

  const createPage = async () => {
    if (!newPagePath) return;
    const endpoint = mode === "pages" ? `/wiki/page/${encodeURIComponent(newPagePath)}` : `/wiki/template/squad/${encodeURIComponent(newPagePath)}`;
    await apiPut(endpoint, { content: `# ${newPagePath}\n\n` });
    setShowNewPage(false);
    setNewPagePath("");
    await fetchPages();
    selectPage(newPagePath);
  };

  const currentPages = mode === "pages" ? pages : templates;
  const filteredPages = search ? currentPages.filter((p) => p.path.toLowerCase().includes(search.toLowerCase()) || p.title.toLowerCase().includes(search.toLowerCase())) : currentPages;

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="w-72 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex gap-2">
            {(["pages", "templates"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setSelectedPage(null); }} className={`px-2 py-1 text-xs rounded ${mode === m ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
                {m === "pages" ? "Pages" : "Templates"}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full px-2 py-1 text-sm bg-input border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button onClick={() => setShowNewPage(true)} className="flex items-center gap-1 text-xs text-primary hover:underline">
            <Plus size={12} /> New {mode === "pages" ? "page" : "template"}
          </button>
        </div>

        {showNewPage && (
          <div className="p-3 border-b border-border space-y-2">
            <input value={newPagePath} onChange={(e) => setNewPagePath(e.target.value)} placeholder="path/to/page" className="w-full px-2 py-1 text-sm bg-input border border-border rounded text-foreground placeholder:text-muted-foreground focus:outline-none" />
            <div className="flex gap-2">
              <button onClick={createPage} className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded">Create</button>
              <button onClick={() => setShowNewPage(false)} className="px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <WikiTree
            pages={filteredPages}
            selectedPage={selectedPage}
            onSelect={selectPage}
          />
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedPage ? (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-bold flex-1">{selectedPage}</h2>
              {!editMode && (
                <>
                  <button onClick={() => { setEditMode(true); setEditContent(content); }} className="text-muted-foreground hover:text-foreground"><Edit size={16} /></button>
                  <button onClick={deletePage} className="text-muted-foreground hover:text-destructive"><Trash2 size={16} /></button>
                </>
              )}
            </div>
            {editMode ? (
              <div className="space-y-3">
                <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={20} className="w-full px-3 py-2 bg-input border border-border rounded-md text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring" />
                <div className="flex gap-2">
                  <button onClick={savePage} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm"><Save size={14} /> Save</button>
                  <button onClick={() => setEditMode(false)} className="flex items-center gap-1 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm"><X size={14} /> Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <MarkdownContent content={content} />
                {backlinks.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-border">
                    <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1"><Link2 size={14} /> Backlinks</h3>
                    <div className="flex flex-wrap gap-2">
                      {backlinks.map((bl) => (
                        <button key={bl} onClick={() => selectPage(bl)} className="text-xs px-2 py-1 bg-muted rounded hover:bg-accent">{bl}</button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a page to view
          </div>
        )}
      </div>
    </div>
  );
}
