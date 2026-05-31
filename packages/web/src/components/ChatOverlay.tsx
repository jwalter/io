import { IoMark } from '@/components/ui/io-mark';
import { type WsMessage, useWebSocket } from '@/hooks/use-websocket';
import { api, getCurrentToken } from '@/lib/api';
import { MessageCircle, Paperclip, Send, Square } from 'lucide-react';
import { marked } from 'marked';
import {
	type ChangeEvent,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

interface OverlayMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: string;
	attachmentName?: string;
}

function formatTimestamp(ts: string | Date): string {
	return new Date(ts).toISOString();
}

export function ChatOverlay() {
	const [open, setOpen] = useState(false);
	const [messages, setMessages] = useState<OverlayMessage[]>([]);
	const [input, setInput] = useState('');
	const [isStreaming, setIsStreaming] = useState(false);
	const [streaming, setStreaming] = useState('');
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const messagesRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const recentMessages = useMemo(() => messages.slice(-10), [messages]);

	const fetchRecentMessages = useCallback(async () => {
		try {
			const data = await api.get<{ messages: OverlayMessage[] }>('/conversations?limit=10');
			setMessages(
				data.messages.map((message) => ({
					...message,
					timestamp: formatTimestamp(message.timestamp),
				})),
			);
		} catch {
			// ignore history fetch failures in the floating overlay
		}
	}, []);

	useEffect(() => {
		void fetchRecentMessages();
	}, [fetchRecentMessages]);

	useEffect(() => {
		if (open) {
			void fetchRecentMessages();
		}
	}, [fetchRecentMessages, open]);

	const handleDelta = useCallback((accumulated: string) => {
		setIsStreaming(true);
		setStreaming(accumulated);
	}, []);

	const handleMessage = useCallback((content: string) => {
		setIsStreaming(false);
		setStreaming('');
		setMessages((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				role: 'assistant',
				content,
				timestamp: formatTimestamp(new Date()),
			},
		]);
	}, []);

	const handleEvent = useCallback((_msg: WsMessage) => {}, []);

	const handleError = useCallback(() => {
		setIsStreaming(false);
		setStreaming('');
	}, []);

	const { connected, sendMessage } = useWebSocket({
		onDelta: handleDelta,
		onMessage: handleMessage,
		onEvent: handleEvent,
		onError: handleError,
	});

	useLayoutEffect(() => {
		const container = messagesRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}, [recentMessages, streaming, isStreaming, open]);

	async function uploadAttachment(file: File, messageId: string) {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('messageId', messageId);

		const token = getCurrentToken();
		const response = await fetch('/api/attachments', {
			method: 'POST',
			body: formData,
			headers: token ? { Authorization: `Bearer ${token}` } : undefined,
		});

		if (!response.ok) {
			throw new Error('Failed to upload attachment');
		}
	}

	async function handleSend() {
		const text = input.trim();
		if ((!text && !selectedFile) || isStreaming) return;

		const messageId = crypto.randomUUID();
		const attachmentName = selectedFile?.name;
		const outboundContent = [text, attachmentName ? `Attachment: ${attachmentName}` : '']
			.filter(Boolean)
			.join('\n\n');

		setMessages((prev) => [
			...prev,
			{
				id: messageId,
				role: 'user',
				content: text,
				timestamp: formatTimestamp(new Date()),
				attachmentName,
			},
		]);
		setInput('');
		setSelectedFile(null);
		setIsStreaming(true);
		setStreaming('');
		if (fileInputRef.current) fileInputRef.current.value = '';
		if (textareaRef.current) textareaRef.current.style.height = 'auto';

		try {
			if (selectedFile) {
				await uploadAttachment(selectedFile, messageId);
			}
			sendMessage(outboundContent);
			setOpen(true);
		} catch {
			setIsStreaming(false);
		}
	}

	function handleInput(event: ChangeEvent<HTMLTextAreaElement>) {
		setInput(event.target.value);
		if (textareaRef.current) {
			textareaRef.current.style.height = 'auto';
			textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 96)}px`;
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void handleSend();
		}
	}

	return (
		<div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
			{open && (
				<div className="w-[340px] h-[460px] rounded-2xl bg-[#222] border border-white/[0.07] shadow-2xl overflow-hidden flex flex-col">
					<div className="bg-gradient-to-r from-[#E43A9C] to-[#9333ea] p-3 rounded-t-2xl flex items-center justify-between gap-3">
						<div className="flex items-center gap-2.5 min-w-0">
							<div className="w-8 h-8 rounded-xl bg-black/15 border border-white/10 flex items-center justify-center flex-shrink-0">
								<IoMark height={16} />
							</div>
							<div className="min-w-0">
								<p className="text-sm font-medium text-white leading-none">Quick Chat</p>
								<p className="text-[10px] font-mono text-white/70 mt-1">
									{connected ? 'live session' : 'reconnecting...'}
								</p>
							</div>
						</div>
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="text-xs font-mono text-white/80 hover:text-white transition-colors"
						>
							Close
						</button>
					</div>

					<div ref={messagesRef} className="flex-1 overflow-y-auto p-3 space-y-2">
						{recentMessages.length === 0 && !isStreaming ? (
							<div className="h-full flex items-center justify-center text-center px-6">
								<p className="text-xs text-zinc-500">Ask IO anything without leaving this page.</p>
							</div>
						) : (
							recentMessages.map((message) => (
								<div
									key={message.id}
									className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
									title={message.timestamp}
								>
									<div className={`max-w-[85%] ${message.role === 'user' ? 'ml-8' : 'mr-8'}`}>
										{message.attachmentName && (
											<div className="mb-1 rounded-xl border border-white/[0.08] bg-[#1e1e1e] px-3 py-2 text-[11px] font-mono text-zinc-400">
												{message.attachmentName}
											</div>
										)}
										{message.content && (
											<div
												className={message.role === 'user' ? 'bg-gradient-to-br from-[#E43A9C] to-[#D83333] rounded-xl px-3 py-2 text-xs text-white whitespace-pre-wrap' : 'bg-[#2a2a2a] rounded-xl px-3 py-2 text-xs text-zinc-200'}
											>
												{message.role === 'user' ? (
													message.content
												) : (
													<div
														className="prose-io [&_*]:text-xs"
														// biome-ignore lint: markdown rendering
														dangerouslySetInnerHTML={{ __html: marked.parse(message.content) as string }}
													/>
												)}
											</div>
										)}
									</div>
								</div>
							))
						)}

						{isStreaming && (
							<div className="flex justify-start">
								<div className="max-w-[85%] mr-8 bg-[#2a2a2a] rounded-xl px-3 py-2 text-xs text-zinc-200">
									{streaming ? (
										<div
											className="prose-io [&_*]:text-xs"
											// biome-ignore lint: streaming markdown
											dangerouslySetInnerHTML={{ __html: marked.parse(streaming) as string }}
										/>
									) : (
										<div className="flex items-center gap-1.5 py-1">
											{[0, 120, 240].map((delay) => (
												<span
													key={delay}
													className="w-1.5 h-1.5 rounded-full bg-[#E43A9C] animate-bounce"
													style={{ animationDelay: `${delay}ms` }}
												/>
											))}
										</div>
									)}
								</div>
							</div>
						)}
					</div>

					<div className="p-3 border-t border-white/[0.07]">
						<div className="bg-[#1e1e1e] border border-white/[0.08] rounded-2xl overflow-hidden transition-colors focus-within:border-[#E43A9C]/30">
							<input
								ref={fileInputRef}
								type="file"
								className="hidden"
								onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
							/>
							{selectedFile && (
								<div className="px-3 pt-2 text-[10px] font-mono text-zinc-400">Attached: {selectedFile.name}</div>
							)}
							<div className="flex items-end gap-2 px-2.5 py-2">
								<button
									type="button"
									onClick={() => fileInputRef.current?.click()}
									className="p-2 rounded-xl hover:bg-white/[0.05] text-zinc-600 hover:text-zinc-300 transition-colors flex-shrink-0"
								>
									<Paperclip className="w-4 h-4" />
								</button>
								<textarea
									ref={textareaRef}
									value={input}
									onChange={handleInput}
									onKeyDown={handleKeyDown}
									placeholder="Message IO…"
									rows={1}
									className="flex-1 bg-transparent py-1 text-sm text-zinc-200 placeholder:text-zinc-700 resize-none focus:outline-none"
									style={{ minHeight: '36px', maxHeight: '96px', fontFamily: 'Inter, sans-serif' }}
								/>
								<button
									type="button"
									onClick={() => {
										if (isStreaming) {
											setIsStreaming(false);
											setStreaming('');
											return;
										}
										void handleSend();
									}}
									disabled={(!input.trim() && !selectedFile) || (!connected && !isStreaming)}
									className="w-9 h-9 rounded-xl text-white disabled:opacity-30 disabled:cursor-not-allowed transition-opacity hover:opacity-90 primary-btn flex items-center justify-center flex-shrink-0 shadow-lg"
								>
									{isStreaming ? <Square className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				className="w-12 h-12 rounded-full primary-btn shadow-lg text-white flex items-center justify-center hover:opacity-95 transition-opacity"
				aria-label={open ? 'Close quick chat' : 'Open quick chat'}
			>
				<MessageCircle className="w-5 h-5" />
			</button>
		</div>
	);
}
