import { Router } from 'express';
import {
	activateSkill,
	deactivateSkill,
	discoverSkills,
	getActiveSkills,
	getSkill,
	installDiscoveredSkill,
	installSkill,
	installSkillFromUrl,
	listInstalledSkills,
	removeSkill,
	updateSkill,
} from '../../skills/index.js';

export const skillsRouter = Router();

function summarizeSkill(content: string): string {
	const summary = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'))
		.join(' ')
		.slice(0, 220)
		.trim();

	return summary || 'No preview available.';
}

// List installed skills
skillsRouter.get('/skills', async (_req, res) => {
	const skills = listInstalledSkills();
	const orchestratorActivations = await getActiveSkills('orchestrator');

	const result = skills.map((s) => ({
		name: s.name,
		activatedForOrchestrator: orchestratorActivations.some((a) => a.skillName === s.name),
		preview: s.content.slice(0, 600),
		description: summarizeSkill(s.content),
		filePath: s.filePath,
	}));

	res.json({ skills: result });
});

// Discover remote skills
skillsRouter.get('/skills/discover', async (req, res) => {
	const source = req.query.source as 'awesome-copilot' | 'skillssh' | undefined;
	const q = (req.query.q as string | undefined) ?? '';

	if (!source || !['awesome-copilot', 'skillssh'].includes(source)) {
		res.status(400).json({ error: 'source must be "awesome-copilot" or "skillssh"' });
		return;
	}

	try {
		const skills = await discoverSkills(source, q);
		res.json({ skills });
	} catch (err) {
		res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
	}
});

// Get a specific skill
skillsRouter.get('/skills/:name', (req, res) => {
	const skill = getSkill(req.params.name);
	if (!skill) {
		res.status(404).json({ error: `Skill '${req.params.name}' not found` });
		return;
	}
	res.json(skill);
});

// Install a skill (from URL, content, or discovery source)
skillsRouter.post('/skills/install', async (req, res) => {
	const { name, url, content, source, registrySource, skillId } = req.body;

	if (!name) {
		res.status(400).json({ error: 'name is required' });
		return;
	}

	try {
		if (source && ['awesome-copilot', 'skillssh'].includes(source)) {
			const skill = await installDiscoveredSkill({ name, source, url, registrySource, skillId });
			res.status(201).json({ installed: true, name: skill.name });
		} else if (url) {
			const skill = await installSkillFromUrl(name, url);
			res.status(201).json({ installed: true, name: skill.name });
		} else if (content) {
			const skill = installSkill(name, content);
			res.status(201).json({ installed: true, name: skill.name });
		} else {
			res.status(400).json({ error: 'Either a discovery source, "url", or "content" is required' });
		}
	} catch (err) {
		res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
	}
});

// Activate a skill
skillsRouter.post('/skills/:name/activate', async (req, res) => {
	const { targetType, targetId } = req.body;
	if (!targetType || !['orchestrator', 'squad'].includes(targetType)) {
		res.status(400).json({ error: 'targetType must be "orchestrator" or "squad"' });
		return;
	}

	const skill = getSkill(req.params.name);
	if (!skill) {
		res.status(404).json({ error: `Skill '${req.params.name}' not found` });
		return;
	}

	await activateSkill(req.params.name, targetType, targetId);
	res.json({ activated: true, skillName: req.params.name, targetType, targetId });
});

// Deactivate a skill
skillsRouter.post('/skills/:name/deactivate', async (req, res) => {
	const { targetType, targetId } = req.body;
	if (!targetType || !['orchestrator', 'squad'].includes(targetType)) {
		res.status(400).json({ error: 'targetType must be "orchestrator" or "squad"' });
		return;
	}

	await deactivateSkill(req.params.name, targetType, targetId);
	res.json({ deactivated: true, skillName: req.params.name });
});

// Update a skill
skillsRouter.put('/skills/:name', (req, res) => {
	const { content } = req.body;
	if (typeof content !== 'string') {
		res.status(400).json({ error: 'content is required' });
		return;
	}

	const skill = updateSkill(req.params.name, content);
	res.json({ updated: true, skill });
});

// Remove a skill
skillsRouter.delete('/skills/:name', (req, res) => {
	removeSkill(req.params.name);
	res.json({ removed: true, name: req.params.name });
});

// Get activations for a target
skillsRouter.get('/skills-activations', async (req, res) => {
	const targetType = (req.query.targetType as string) ?? 'orchestrator';
	const targetId = req.query.targetId as string | undefined;
	const activations = await getActiveSkills(targetType as 'orchestrator' | 'squad', targetId);
	res.json({ activations });
});
