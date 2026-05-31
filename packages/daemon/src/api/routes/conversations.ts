import { Router } from 'express';
import { listConversationMessages } from '../../store/conversations.js';

export function conversationsRouter(): Router {
	const router = Router();

	/**
	 * GET /api/conversations
	 * Load chat history with cursor-based pagination.
	 * Query params: limit (default 50), before (message id for pagination)
	 */
	router.get('/conversations', async (req, res) => {
		try {
			const page = await listConversationMessages({
				limit: Number.parseInt(req.query.limit as string, 10) || 50,
				before: req.query.before as string | undefined,
			});

			res.json(page);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load conversations';
			res.status(message.includes('Invalid cursor') ? 400 : 500).json({ error: message });
		}
	});

	return router;
}
