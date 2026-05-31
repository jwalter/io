import { getDatabase } from './db.js';

export type ConversationRole = 'user' | 'assistant';

export interface ConversationMessage {
	id: string;
	role: ConversationRole;
	content: string;
	source: string | null;
	attachments: unknown[] | null;
	timestamp: string;
}

export interface ConversationPage {
	messages: ConversationMessage[];
	cursor: string | null;
	hasMore: boolean;
}

export async function appendConversationMessage(params: {
	role: ConversationRole;
	content: string;
	source?: string;
	createdAt?: string;
}): Promise<ConversationMessage> {
	const db = getDatabase();
	const message: ConversationMessage = {
		id: crypto.randomUUID(),
		role: params.role,
		content: params.content,
		source: params.source ?? null,
		attachments: null,
		timestamp: params.createdAt ?? new Date().toISOString(),
	};

	await db.execute({
		sql: 'INSERT INTO conversations (id, role, content, source, created_at) VALUES (?, ?, ?, ?, ?)',
		args: [message.id, message.role, message.content, message.source, message.timestamp],
	});

	return message;
}

type ConversationRow = {
	id: string;
	role: ConversationRole;
	content: string;
	source: string | null;
	attachments: string | null;
	created_at: string;
};

function toConversationRow(row: Record<string, unknown>): ConversationRow {
	return {
		id: row.id as string,
		role: row.role as ConversationRole,
		content: row.content as string,
		source: row.source as string | null,
		attachments: row.attachments as string | null,
		created_at: row.created_at as string,
	};
}

export async function listConversationMessages(params?: {
	limit?: number;
	before?: string;
}): Promise<ConversationPage> {
	const db = getDatabase();
	const limit = Math.min(params?.limit ?? 50, 200);
	const before = params?.before;

	let rows: ConversationRow[];

	if (before) {
		const cursorResult = await db.execute({
			sql: 'SELECT created_at FROM conversations WHERE id = ?',
			args: [before],
		});

		if (cursorResult.rows.length === 0) {
			throw new Error('Invalid cursor: message not found');
		}

		const cursorTime = cursorResult.rows[0].created_at as string;
		const result = await db.execute({
			sql: `SELECT id, role, content, source, attachments, created_at
				FROM conversations
				WHERE created_at < ? OR (created_at = ? AND id < ?)
				ORDER BY created_at DESC, id DESC
				LIMIT ?`,
			args: [cursorTime, cursorTime, before, limit],
		});

		rows = result.rows.map((row) => toConversationRow(row as unknown as Record<string, unknown>));
	} else {
		const result = await db.execute({
			sql: `SELECT id, role, content, source, attachments, created_at
				FROM conversations
				ORDER BY created_at DESC, id DESC
				LIMIT ?`,
			args: [limit],
		});

		rows = result.rows.map((row) => toConversationRow(row as unknown as Record<string, unknown>));
	}

	const messages = rows.reverse().map((row) => ({
		id: row.id,
		role: row.role,
		content: row.content,
		source: row.source,
		attachments: row.attachments ? (JSON.parse(row.attachments) as unknown[]) : null,
		timestamp: row.created_at,
	}));

	return {
		messages,
		cursor: rows.length > 0 ? rows[0].id : null,
		hasMore: rows.length === limit,
	};
}
