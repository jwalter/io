import { PrimaryBtn, SecondaryBtn } from '@/components/ui/shared';
import { api } from '@/lib/api';
import { BookOpen, FileText, Plus, Save, Search, Trash2 } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface WikiPage {
	name: string;
	path: string;
}

export function WikiView() {
	const [scope, setScope] = useState('shared');
	const [pages, setPages] = useState<WikiPage[]>([]);
	const [selectedPage, setSelectedPage] = useState<string | null>(null);
	const [content, setContent] = useState('');
	const [editing, setEditing] = useState(false);
	const [editContent, setEditContent] = useState('');
	const [creating, setCreating] = useState(false);
	const [newPageName, setNewPageName] = useState('');
	const [search, setSearch] = useState('');

	useEffect(() => {
		loadPages();
	}, [scope]);

	function loadPages() {
		api
			.get<{ scope: string; pages: WikiPage[] }>(`/wiki/${scope}`)
			.then((d) => setPages(d.pages))
			.catch(() => setPages([]));
	}

	async function loadPage(name: string) {
		try {
			const data = await api.get<{ content: string }>(`/wiki/${scope}/${name}`);
			setContent(data.content);
			setSelectedPage(name);
			setEditing(false);
		} catch {
			toast.error('Failed to load page');
		}
	}

	async function savePage() {
		if (!selectedPage) return;
		try {
			await api.put(`/wiki/${scope}/${selectedPage}`, { content: editContent });
			setContent(editContent);
			setEditing(false);
			toast.success('Page saved');
		} catch {
			toast.error('Failed to save');
		}
	}

	async function deletePage() {
		if (!selectedPage) return;
		try {
			await api.delete(`/wiki/${scope}/${selectedPage}`);
			toast.success('Page deleted');
			setSelectedPage(null);
			setContent('');
			loadPages();
		} catch {
			toast.error('Failed to delete');
		}
	}

	async function createPage() {
		if (!newPageName.trim()) return;
		try {
			await api.put(`/wiki/${scope}/${newPageName}`, { content: `# ${newPageName}\n\n` });
			toast.success('Page created');
			setCreating(false);
			setNewPageName('');
			loadPages();
			loadPage(newPageName);
		} catch {
			toast.error('Failed to create page');
		}
	}

	const filteredPages = pages.filter(
		(p) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<div className="flex h-full">
			{/* File tree sidebar */}
			<div className="w-64 border-r border-white/[0.07] flex flex-col h-full bg-[#181818]">
				<div className="p-3 border-b border-white/[0.07]">
					<h2
						className="text-lg tracking-wide text-zinc-100 mb-2"
						style={{ fontFamily: "'Bebas Neue', sans-serif" }}
					>
						Wiki
					</h2>
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search pages..."
							className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 outline-none focus:border-[#E43A9C]/50"
						/>
					</div>
				</div>

				{/* Scope selector */}
				<div className="flex gap-1 p-2 border-b border-white/[0.07]">
					{['shared', 'io'].map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => {
								setScope(s);
								setSelectedPage(null);
							}}
							className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors ${
								scope === s
									? 'bg-white/10 text-zinc-200'
									: 'text-zinc-600 hover:text-zinc-400'
							}`}
						>
							{s}
						</button>
					))}
				</div>

				{/* Pages */}
				<div className="flex-1 overflow-y-auto p-2 space-y-0.5">
					{filteredPages.map((page) => (
						<button
							key={page.name}
							type="button"
							onClick={() => loadPage(page.name)}
							className={`w-full text-left px-3 py-2 rounded-lg text-[11px] font-mono flex items-center gap-2 transition-colors ${
								selectedPage === page.name
									? 'bg-[#E43A9C]/10 text-[#E43A9C] border-l-2 border-[#E43A9C]'
									: 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]'
							}`}
						>
							<FileText size={13} className="flex-shrink-0" />
							{page.name}
						</button>
					))}
					{filteredPages.length === 0 && (
						<p className="text-[11px] text-zinc-700 font-mono text-center py-4">
							No pages found
						</p>
					)}
				</div>

				{/* Create page */}
				<div className="p-2 border-t border-white/[0.07]">
					{creating ? (
						<div className="flex gap-1">
							<input
								type="text"
								value={newPageName}
								onChange={(e) => setNewPageName(e.target.value)}
								placeholder="page-name"
								className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-mono bg-white/[0.04] border border-white/[0.07] text-zinc-300 outline-none focus:border-[#E43A9C]/50"
								onKeyDown={(e) => {
									if (e.key === 'Enter') createPage();
									if (e.key === 'Escape') setCreating(false);
								}}
								autoFocus
							/>
							<button
								type="button"
								onClick={createPage}
								className="px-2.5 py-1.5 rounded-lg text-[11px] bg-[#E43A9C] text-white"
							>
								OK
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={() => setCreating(true)}
							className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-mono text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.04] transition-colors"
						>
							<Plus size={13} /> New page
						</button>
					)}
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 flex flex-col overflow-hidden">
				{selectedPage ? (
					<>
						<div className="h-12 flex items-center px-6 border-b border-white/[0.07] justify-between shrink-0">
							<h3 className="text-sm font-mono text-zinc-200">{selectedPage}</h3>
							<div className="flex items-center gap-2">
								{editing ? (
									<>
										<PrimaryBtn onClick={savePage} className="px-3 py-1">
											<Save size={12} /> Save
										</PrimaryBtn>
										<SecondaryBtn
											onClick={() => setEditing(false)}
											className="px-3 py-1"
										>
											Cancel
										</SecondaryBtn>
									</>
								) : (
									<>
										<SecondaryBtn
											onClick={() => {
												setEditing(true);
												setEditContent(content);
											}}
											className="px-3 py-1"
										>
											Edit
										</SecondaryBtn>
										<button
											type="button"
											onClick={deletePage}
											className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
										>
											<Trash2 size={13} />
										</button>
									</>
								)}
							</div>
						</div>
						<div className="flex-1 overflow-y-auto p-6">
							{editing ? (
								<textarea
									value={editContent}
									onChange={(e) => setEditContent(e.target.value)}
									className="w-full h-full bg-transparent font-mono text-sm text-zinc-300 outline-none resize-none"
								/>
							) : (
								<div
									className="prose-io"
									// biome-ignore lint: markdown rendering
									dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
								/>
							)}
						</div>
					</>
				) : (
					<div className="h-full flex items-center justify-center">
						<div className="text-center">
							<BookOpen size={48} className="mx-auto mb-3 text-zinc-800" />
							<p className="text-[11px] font-mono text-zinc-700">
								Select a page to view
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
