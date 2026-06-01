import { pushNotification } from '@/components/NotificationPanel';
import { api, getCurrentToken } from '@/lib/api';
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from 'react';
import { type WsMessage, useWebSocket } from './use-websocket';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: string;
	attachmentName?: string;
	toolCall?: {
		name: string;
		status: 'running' | 'done' | 'error';
		result?: string;
	};
	attachments?: string[] | null;
}

interface ChatContextValue {
	messages: ChatMessage[];
	streaming: string;
	isStreaming: boolean;
	isThinking: boolean;
	connected: boolean;
	sendChatMessage: (content: string) => void;
	addUserMessage: (msg: ChatMessage) => void;
	uploadAttachment: (file: File, messageId: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [streaming, setStreaming] = useState('');
	const [isStreaming, setIsStreaming] = useState(false);
	const [isThinking, setIsThinking] = useState(false);
	const loadedRef = useRef(false);

	// Load conversation history once
	useEffect(() => {
		if (loadedRef.current) return;
		loadedRef.current = true;
		api
			.get<{ messages: ChatMessage[] }>('/conversations?limit=50')
			.then((data) => {
				setMessages(data.messages.map((m) => ({ ...m, timestamp: m.timestamp })));
			})
			.catch(() => {});
	}, []);

	const handleDelta = useCallback((accumulated: string) => {
		setIsThinking(false);
		setIsStreaming(true);
		setStreaming(accumulated);
	}, []);

	const handleMessage = useCallback((content: string) => {
		setIsThinking(false);
		setIsStreaming(false);
		setStreaming('');
		setMessages((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				role: 'assistant',
				content,
				timestamp: new Date().toISOString(),
			},
		]);
	}, []);

	const handleEvent = useCallback((msg: WsMessage) => {
		if (msg.notification) {
			pushNotification({
				id: msg.event?.id ?? crypto.randomUUID(),
				message: msg.notification,
				timestamp: msg.event?.timestamp ?? new Date().toISOString(),
				eventType: msg.event?.type ?? 'unknown',
			});
		}
	}, []);

	const handleError = useCallback(() => {
		setIsThinking(false);
		setIsStreaming(false);
		setStreaming('');
	}, []);

	const { connected, sendMessage } = useWebSocket({
		onDelta: handleDelta,
		onMessage: handleMessage,
		onEvent: handleEvent,
		onError: handleError,
	});

	const sendChatMessage = useCallback(
		(content: string) => {
			setIsThinking(true);
			sendMessage(content);
		},
		[sendMessage],
	);

	const addUserMessage = useCallback((msg: ChatMessage) => {
		setMessages((prev) => [...prev, msg]);
	}, []);

	const uploadAttachment = useCallback(async (file: File, messageId: string) => {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('messageId', messageId);

		const token = getCurrentToken();
		const res = await fetch('/api/attachments', {
			method: 'POST',
			body: formData,
			headers: token ? { Authorization: `Bearer ${token}` } : undefined,
		});

		if (!res.ok) {
			throw new Error('Failed to upload attachment');
		}
	}, []);

	return (
		<ChatContext.Provider
			value={{
				messages,
				streaming,
				isStreaming,
				isThinking,
				connected,
				sendChatMessage,
				addUserMessage,
				uploadAttachment,
			}}
		>
			{children}
		</ChatContext.Provider>
	);
}

export function useChat(): ChatContextValue {
	const ctx = useContext(ChatContext);
	if (!ctx) {
		throw new Error('useChat must be used within a ChatProvider');
	}
	return ctx;
}
