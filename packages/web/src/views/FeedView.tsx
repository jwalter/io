import { Chip } from '@/components/ui/shared';
import { api } from '@/lib/api';
import { Inbox, Mail, MailOpen } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useState } from 'react';

interface FeedItem {
	id: string;
	kind: string;
	title: string;
	content: string;
	squadId: string | null;
	status: string;
	response: string | null;
	createdAt: string;
}

export function FeedView() {
	const [items, setItems] = useState<FeedItem[]>([]);
	const [selected, setSelected] = useState<FeedItem | null>(null);
	const [filter, setFilter] = useState<'all' | 'unread'>('all');

	useEffect(() => {
		api
			.get<{ entries: FeedItem[] }>('/inbox')
			.then((d) => setItems(d.entries))
			.catch(() => {});
	}, []);

	function handleSelect(item: FeedItem) {
		setSelected(item);
		if (item.status === 'unread') {
			api
				.post(`/inbox/${item.id}/read`)
				.then(() => {
					setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'read' } : i)));
				})
				.catch(() => {});
		}
	}

	const filtered = items.filter((i) => filter === 'all' || i.status === 'unread');
	const unreadCount = items.filter((i) => i.status === 'unread').length;

	return (
		<div className="flex h-full">
			{/* List */}
			<div className="w-80 border-r border-white/[0.07] flex flex-col h-full bg-[#181818]">
				<div className="p-3 border-b border-white/[0.07]">
					<div className="flex items-center justify-between mb-2">
						<h2
							className="text-lg tracking-wide text-zinc-100"
							style={{ fontFamily: "'Bebas Neue', sans-serif" }}
						>
							Inbox
						</h2>
						{unreadCount > 0 && (
							<Chip variant="default">{unreadCount}</Chip>
						)}
					</div>
					<div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.07]">
						{(['all', 'unread'] as const).map((f) => (
							<button
								key={f}
								type="button"
								onClick={() => setFilter(f)}
								className={`flex-1 px-2 py-1 rounded-lg text-[11px] font-mono transition-colors ${
									filter === f
										? 'bg-[#E43A9C]/15 text-[#E43A9C]'
										: 'text-zinc-600 hover:text-zinc-400'
								}`}
							>
								{f === 'all' ? 'All' : 'Unread'}
							</button>
						))}
					</div>
				</div>
				<div className="flex-1 overflow-y-auto">
					{filtered.map((item) => (
						<button
							key={item.id}
							onClick={() => handleSelect(item)}
							type="button"
							className={`w-full text-left px-4 py-3 border-b border-white/[0.05] transition-colors ${
								selected?.id === item.id
									? 'bg-white/[0.06]'
									: 'hover:bg-white/[0.03]'
							} ${item.status === 'unread' ? 'border-l-2 border-l-[#E43A9C]' : ''}`}
						>
							<div className="flex items-center gap-2">
								{item.status === 'unread' ? (
									<Mail size={12} className="text-[#E43A9C] flex-shrink-0" />
								) : (
									<MailOpen size={12} className="text-zinc-700 flex-shrink-0" />
								)}
								<span className="text-[10px] text-zinc-600 font-mono uppercase">
									{item.kind}
								</span>
							</div>
							<p
								className={`text-sm mt-1 truncate ${
									item.status === 'unread' ? 'text-zinc-200 font-medium' : 'text-zinc-400'
								}`}
							>
								{item.title}
							</p>
							<p className="text-[10px] text-zinc-700 font-mono mt-0.5">
								{new Date(item.createdAt).toLocaleString()}
							</p>
						</button>
					))}
					{filtered.length === 0 && (
						<div className="flex flex-col items-center justify-center py-12">
							<Inbox size={32} className="text-zinc-800 mb-2" />
							<p className="text-[11px] font-mono text-zinc-700">
								{filter === 'unread' ? 'All caught up' : 'No items yet'}
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Detail */}
			<div className="flex-1 overflow-y-auto p-6">
				{selected ? (
					<div>
						<h2 className="text-lg text-zinc-100 font-medium mb-1">{selected.title}</h2>
						<p className="text-[11px] text-zinc-600 font-mono mb-5">
							{selected.kind} · {new Date(selected.createdAt).toLocaleString()}
						</p>
						<div
							className="prose-io"
							// biome-ignore lint: markdown rendering
							dangerouslySetInnerHTML={{ __html: marked.parse(selected.content) as string }}
						/>
					</div>
				) : (
					<div className="h-full flex items-center justify-center">
						<p className="text-[11px] font-mono text-zinc-700">
							Select an item to view details
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
