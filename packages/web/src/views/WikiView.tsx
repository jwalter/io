import { DangerBtn, PrimaryBtn, SecondaryBtn } from '@/components/ui/shared';
import { api } from '@/lib/api';
import {
	BookOpen,
	ChevronRight,
	FileText,
	Folder,
	FolderOpen,
	Pencil,
	Plus,
	Save,
	Search,
	Trash2,
} from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface WikiPage {
	name: string;
	path: string;
}

interface TreeNode {
	name: string;
	path: string;
	isDir: boolean;
	children: TreeNode[];
}

const WIKI_SCOPE = 'shared';

function sortTree(nodes: TreeNode[]): TreeNode[] {
	return [...nodes]
		.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name);
		})
		.map((node) => ({ ...node, children: sortTree(node.children) }));
}

function buildTree(pages: WikiPage[]): TreeNode[] {
	const root: TreeNode[] = [];

	for (const page of pages) {
		const segments = page.path.split('/').filter(Boolean);
		let currentLevel = root;
		let currentPath = '';

		for (const [index, segment] of segments.entries()) {
			const isFile = index === segments.length - 1;
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;

			let node = currentLevel.find((candidate) => candidate.path === currentPath);
			if (!node) {
				node = {
					name: isFile ? page.name || segment : segment,
					path: currentPath,
					isDir: !isFile,
					children: [],
				};
				currentLevel.push(node);
			}

			currentLevel = node.children;
		}
	}

	return sortTree(root);
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
	if (!query) return nodes;

	return nodes.flatMap((node) => {
		const matches =
			node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query);

		if (!node.isDir) {
			return matches ? [node] : [];
		}

		if (matches) {
			return [node];
		}

		const children = filterTree(node.children, query);
		return children.length ? [{ ...node, children }] : [];
	});
}

function collectDirectoryPaths(nodes: TreeNode[]): Set<string> {
	const paths = new Set<string>();

	for (const node of nodes) {
		if (!node.isDir) continue;
		paths.add(node.path);
		for (const childPath of collectDirectoryPaths(node.children)) {
			paths.add(childPath);
		}
	}

	return paths;
}

function getAncestorPaths(path: string): string[] {
	const segments = path.split('/').filter(Boolean);
	const ancestors: string[] = [];
	let currentPath = '';

	for (const segment of segments.slice(0, -1)) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		ancestors.push(currentPath);
	}

	return ancestors;
}

function TreeItem({
	node,
	depth,
	selectedPage,
	expandedPaths,
	autoExpandedPaths,
	onToggle,
	onSelect,
}: {
	node: TreeNode;
	depth: number;
	selectedPage: string | null;
	expandedPaths: Set<string>;
	autoExpandedPaths: Set<string>;
	onToggle: (path: string) => void;
	onSelect: (path: string) => void;
}) {
	const isSelected = selectedPage === node.path;
	const isExpanded = node.isDir && (expandedPaths.has(node.path) || autoExpandedPaths.has(node.path));
	const paddingLeft = 12 + depth * 16;

	if (node.isDir) {
		return (
			<div>
				<button
					type="button"
					onClick={() => onToggle(node.path)}
					className="flex w-full items-center gap-2 rounded-lg py-2 pr-3 text-left text-[11px] font-mono text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200"
					style={{ paddingLeft }}
				>
					<ChevronRight
						size={14}
						className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
					/>
					{isExpanded ? (
						<FolderOpen size={14} className="shrink-0 text-zinc-500" />
					) : (
						<Folder size={14} className="shrink-0 text-zinc-500" />
					)}
					<span className="truncate">{node.name}</span>
				</button>
				{isExpanded && (
					<div>
						{node.children.map((child) => (
							<TreeItem
								key={child.path}
								node={child}
								depth={depth + 1}
								selectedPage={selectedPage}
								expandedPaths={expandedPaths}
								autoExpandedPaths={autoExpandedPaths}
								onToggle={onToggle}
								onSelect={onSelect}
							/>
						))}
					</div>
				)}
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={() => onSelect(node.path)}
			className={`flex w-full items-center gap-2 rounded-lg py-2 pr-3 text-left text-[11px] font-mono transition-colors ${
				isSelected
					? 'border-l-2 border-[#E43A9C] bg-[#E43A9C]/10 text-[#E43A9C]'
					: 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
			}`}
			style={{ paddingLeft }}
		>
			<FileText size={14} className="shrink-0" />
			<span className="truncate">{node.name}</span>
		</button>
	);
}

export function WikiView() {
	const [pages, setPages] = useState<WikiPage[]>([]);
	const [selectedPage, setSelectedPage] = useState<string | null>(null);
	const [content, setContent] = useState('');
	const [editing, setEditing] = useState(false);
	const [editContent, setEditContent] = useState('');
	const [newPageName, setNewPageName] = useState('');
	const [search, setSearch] = useState('');
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

	useEffect(() => {
		loadPages();
	}, []);

	const tree = useMemo(() => buildTree(pages), [pages]);
	const normalizedQuery = search.trim().toLowerCase();
	const filteredTree = useMemo(() => filterTree(tree, normalizedQuery), [tree, normalizedQuery]);
	const autoExpandedPaths = useMemo(() => {
		const paths = normalizedQuery ? collectDirectoryPaths(filteredTree) : new Set<string>();
		if (selectedPage) {
			for (const ancestor of getAncestorPaths(selectedPage)) {
				paths.add(ancestor);
			}
		}
		return paths;
	}, [filteredTree, normalizedQuery, selectedPage]);
	const selectedNode = selectedPage
		? (function findNode(nodes: TreeNode[]): TreeNode | null {
				for (const n of nodes) {
					if (n.path === selectedPage) return n;
					const found = findNode(n.children);
					if (found) return found;
				}
				return null;
			})(filteredTree)
		: null;
	const selectedPageName = selectedNode?.name ?? (selectedPage ? selectedPage.split('/').pop() ?? '' : '');

	useEffect(() => {
		const directoryPaths = collectDirectoryPaths(tree);
		setExpandedPaths((previous) => {
			const next = new Set([...previous].filter((path) => directoryPaths.has(path)));
			if (next.size === 0) {
				for (const node of tree) {
					if (node.isDir) next.add(node.path);
				}
			}
			return next;
		});
	}, [tree]);

	async function loadPages() {
		try {
			const data = await api.get<{ scope: string; pages: WikiPage[] }>(`/wiki/${WIKI_SCOPE}`);
			setPages(data.pages);
		} catch {
			setPages([]);
		}
	}

	async function loadPage(path: string) {
		try {
			const data = await api.get<{ content: string }>(`/wiki/${WIKI_SCOPE}/${path}`);
			setContent(data.content);
			setEditContent(data.content);
			setSelectedPage(path);
			setEditing(false);
		} catch {
			toast.error('Failed to load page');
		}
	}

	async function savePage() {
		if (!selectedPage) return;
		try {
			await api.put(`/wiki/${WIKI_SCOPE}/${selectedPage}`, { content: editContent });
			setContent(editContent);
			setEditing(false);
			toast.success('Page saved');
		} catch {
			toast.error('Failed to save page');
		}
	}

	async function deletePage() {
		if (!selectedPage) return;
		try {
			await api.delete(`/wiki/${WIKI_SCOPE}/${selectedPage}`);
			toast.success('Page deleted');
			setSelectedPage(null);
			setContent('');
			setEditContent('');
			setEditing(false);
			loadPages();
		} catch {
			toast.error('Failed to delete page');
		}
	}

	async function createPage() {
		let path = newPageName.trim().replace(/^\/+|\/+$/g, '');
		if (!path) return;
		// Strip .md extension if user included it (backend appends .md)
		path = path.replace(/\.md$/i, '');

		try {
			const title = path.split('/').slice(-1)[0] ?? path;
			await api.put(`/wiki/${WIKI_SCOPE}/${path}`, { content: `# ${title}\n\n` });
			toast.success('Page created');
			setNewPageName('');
			await loadPages();
			await loadPage(path);
		} catch {
			toast.error('Failed to create page');
		}
	}

	function toggleDirectory(path: string) {
		setExpandedPaths((previous) => {
			const next = new Set(previous);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}

	return (
		<div className="flex h-full">
			<div className="flex h-full w-64 flex-col border-r border-white/[0.07] bg-[#181818]">
				<div className="border-b border-white/[0.07] p-3">
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
						<input
							type="text"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search pages..."
							className="w-full rounded-lg border border-white/[0.07] bg-white/[0.04] py-2 pl-8 pr-3 text-[11px] font-mono text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[#E43A9C]/50"
						/>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto px-2 py-3">
					{filteredTree.length > 0 ? (
						filteredTree.map((node) => (
							<TreeItem
								key={node.path}
								node={node}
								depth={0}
								selectedPage={selectedPage}
								expandedPaths={expandedPaths}
								autoExpandedPaths={autoExpandedPaths}
								onToggle={toggleDirectory}
								onSelect={loadPage}
							/>
						))
					) : (
						<p className="py-4 text-center font-mono text-[11px] text-zinc-700">No pages found</p>
					)}
				</div>

				<div className="border-t border-white/[0.07] p-3">
					<div className="space-y-2">
						<input
							type="text"
							value={newPageName}
							onChange={(event) => setNewPageName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter') createPage();
								if (event.key === 'Escape') setNewPageName('');
							}}
							placeholder="folder/new-page"
							className="w-full rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 py-2 text-[11px] font-mono text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-[#E43A9C]/50"
						/>
						<PrimaryBtn
							onClick={createPage}
							disabled={!newPageName.trim()}
							className="w-full justify-center px-3 py-2"
						>
							<Plus size={13} /> Add Page
						</PrimaryBtn>
					</div>
				</div>
			</div>

			<div className="flex flex-1 flex-col overflow-hidden">
				{selectedPage ? (
					<>
						<div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-6">
							<div className="min-w-0">
								<h3 className="truncate font-mono text-sm text-zinc-100">{selectedPageName}</h3>
								<p className="truncate font-mono text-[11px] text-zinc-500">{selectedPage}.md</p>
							</div>
							<div className="flex items-center gap-2">
								{editing ? (
									<>
										<PrimaryBtn onClick={savePage} className="px-3 py-1.5">
											<Save size={12} /> Save
										</PrimaryBtn>
										<SecondaryBtn
											onClick={() => {
												setEditing(false);
												setEditContent(content);
											}}
											className="px-3 py-1.5"
										>
											Cancel
										</SecondaryBtn>
									</>
								) : (
									<SecondaryBtn
										onClick={() => {
											setEditing(true);
											setEditContent(content);
										}}
										className="px-3 py-1.5"
									>
										<Pencil size={12} /> Edit
									</SecondaryBtn>
								)}
								<DangerBtn onClick={deletePage} className="px-3 py-1.5">
									<Trash2 size={12} /> Delete
								</DangerBtn>
							</div>
						</div>

						<div className="flex-1 overflow-y-auto bg-[#111111] p-6">
							{editing ? (
								<textarea
									value={editContent}
									onChange={(event) => setEditContent(event.target.value)}
									className="h-full min-h-[320px] w-full resize-none rounded-xl border border-white/[0.07] bg-[#181818] p-4 font-mono text-sm text-zinc-300 outline-none focus:border-[#E43A9C]/50"
								/>
							) : (
								<div className="mx-auto max-w-4xl rounded-xl border border-white/[0.07] bg-[#181818] p-6">
									<div
										className="prose-io text-sm text-zinc-300"
										// biome-ignore lint: markdown rendering
										dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
									/>
								</div>
							)}
						</div>
					</>
				) : (
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<BookOpen size={48} className="mx-auto mb-3 text-zinc-800" />
							<p className="font-mono text-[11px] text-zinc-700">Select a page to view</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
