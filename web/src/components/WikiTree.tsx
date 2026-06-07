import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";

interface WikiPage {
  path: string;
  title: string;
}

interface WikiTreeProps {
  pages: WikiPage[];
  selectedPage: string | null;
  onSelect: (path: string) => void;
}

interface TreeNode {
  name: string;
  path?: string;
  children: TreeNode[];
}

function buildTree(pages: WikiPage[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const page of pages) {
    const parts = page.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      let node = current.find((n) => n.name === name);

      if (!node) {
        node = { name, children: [], ...(isLast ? { path: page.path } : {}) };
        current.push(node);
      } else if (isLast) {
        node.path = page.path;
      }

      current = node.children;
    }
  }

  return root;
}

function TreeNodeComponent({ node, selectedPage, onSelect, depth = 0 }: { node: TreeNode; selectedPage: string | null; onSelect: (path: string) => void; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = node.children.length > 0 && !node.path;
  const isSelected = node.path === selectedPage;

  if (isFolder) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeNodeComponent key={child.name} node={child} selectedPage={selectedPage} onSelect={onSelect} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => node.path && onSelect(node.path)}
      className={`flex items-center gap-1 w-full px-2 py-1 text-sm rounded ${
        isSelected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <FileText size={14} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function WikiTree({ pages, selectedPage, onSelect }: WikiTreeProps) {
  const tree = useMemo(() => buildTree(pages), [pages]);

  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeNodeComponent key={node.name} node={node} selectedPage={selectedPage} onSelect={onSelect} />
      ))}
    </div>
  );
}
