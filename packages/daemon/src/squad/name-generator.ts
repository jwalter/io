import { getClient } from '../copilot/client.js';
import { createChildLogger } from '../logging/logger.js';

const logger = () => createChildLogger('name-generator');

export interface NameAssignment {
	role: string;
	displayName: string;
	persona: string;
}

export interface GeneratedNames {
	universe: string;
	assignments: NameAssignment[];
}

const NAME_GENERATION_PROMPT = `You are a creative casting director. Your job is to assign pop-culture character names and personalities to a team of senior AI engineering agents.

Rules:
- Each character must be UNIQUE within the team
- Match character personalities to the role's nature:
  - A methodical, detail-obsessed character for QA/testing roles
  - A creative, fast-moving character for frontend/UI roles
  - A wise, strategic character for the Technical PM
  - A steady, reliable character for backend/infrastructure roles
  - A curious, analytical character for data/AI roles
- The persona must be 2-3 sentences describing how this character communicates — their tone, quirks, catchphrases, and communication style. These personas will be used as system prompts for AI agents, so make them vivid and actionable.
- Characters should match the SENIORITY of the roles (these are senior/principal engineers, not juniors)
- Return ONLY valid JSON, no markdown fencing

Respond with this exact JSON structure:
{
  "universe": "<the universe name>",
  "assignments": [
    { "role": "<exact role title as given>", "displayName": "<character name>", "persona": "<2-3 sentence persona description>" }
  ]
}`;

/**
 * Generate character names and persona blurbs for squad members using the LLM.
 * If a universe is provided, names come from that universe.
 * If not, the LLM picks a fun universe on its own.
 */
export async function generateSquadNames(
	roles: string[],
	universe?: string,
): Promise<GeneratedNames> {
	const log = logger();

	const roleList = roles.map((r) => `- ${r}`).join('\n');
	const userPrompt = universe
		? `Assign character names from the "${universe}" universe to these senior engineering team roles:\n${roleList}\n\nPick characters whose personalities genuinely match each role's responsibilities. Explain in the persona how that character's traits manifest in technical communication.`
		: `Pick a fun pop-culture universe and assign character names to these senior engineering team roles:\n${roleList}\n\nPick characters whose personalities genuinely match each role's responsibilities. Explain in the persona how that character's traits manifest in technical communication.`;

	try {
		const client = await getClient();
		const session = await client.createSession({
			systemMessage: { mode: 'replace' as const, content: NAME_GENERATION_PROMPT },
		});

		let accumulated = '';
		const unsubDelta = session.on('assistant.message_delta', (event) => {
			accumulated += event.data.deltaContent;
		});

		try {
			await session.sendAndWait({ prompt: userPrompt }, 60_000);
		} finally {
			unsubDelta();
		}

		// Parse the JSON response
		const parsed = extractJson(accumulated);
		if (!parsed || !parsed.universe || !Array.isArray(parsed.assignments)) {
			throw new Error('Invalid response structure from LLM');
		}

		// Validate all roles are covered
		const result: GeneratedNames = {
			universe: parsed.universe as string,
			assignments: [],
		};

		for (const role of roles) {
			const match = (parsed.assignments as Record<string, string>[]).find(
				(a) => a.role?.toLowerCase() === role.toLowerCase(),
			);
			if (match) {
				result.assignments.push({
					role,
					displayName: match.displayName || match.display_name || role,
					persona: match.persona || '',
				});
			} else {
				// Role wasn't in LLM response — use role name as fallback
				result.assignments.push({ role, displayName: role, persona: '' });
			}
		}

		log.info({ universe: result.universe, count: result.assignments.length }, 'Names generated');
		return result;
	} catch (err) {
		log.error({ err, roles, universe }, 'Failed to generate names, falling back to role names');
		return fallback(roles);
	}
}

/** Fallback: use role names as display names with no persona */
function fallback(roles: string[]): GeneratedNames {
	return {
		universe: 'none',
		assignments: roles.map((role) => ({ role, displayName: role, persona: '' })),
	};
}

/** Extract JSON from LLM response (handles possible markdown fencing) */
function extractJson(text: string): Record<string, unknown> | null {
	try {
		return JSON.parse(text.trim());
	} catch {
		// Try extracting from markdown code fence
		const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
		if (match) {
			try {
				return JSON.parse(match[1].trim());
			} catch {
				return null;
			}
		}
		// Try finding JSON object in text
		const braceMatch = text.match(/\{[\s\S]*\}/);
		if (braceMatch) {
			try {
				return JSON.parse(braceMatch[0]);
			} catch {
				return null;
			}
		}
		return null;
	}
}
