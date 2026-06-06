import type { UsageQueryParams } from "@io/shared";
import { Router } from "express";

import { getDailyUsage, getUsageRecords } from "../../store/index.js";

const router = Router();

router.get("/api/usage", async (req, res) => {
	try {
		const params = getUsageParams(req.query);
		const result = await getUsageRecords(params);
		res.status(200).json(result);
	} catch (error) {
		res.status(500).json({
			error: "Failed to fetch usage",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

router.get("/api/usage/daily", async (req, res) => {
	try {
		const params = getUsageParams(req.query);
		const daily = await getDailyUsage(params.startDate ?? null, params.endDate ?? null, {
			squadId: params.squadId,
			agentId: params.agentId,
			model: params.model,
		});
		res.status(200).json(daily);
	} catch (error) {
		res.status(500).json({
			error: "Failed to fetch daily usage",
			details: error instanceof Error ? error.message : "Unknown error",
		});
	}
});

function getUsageParams(query: Record<string, unknown>): UsageQueryParams {
	const since = typeof query.since === "string" ? query.since : undefined;
	return {
		startDate: typeof query.startDate === "string" ? query.startDate : since,
		endDate: typeof query.endDate === "string" ? query.endDate : undefined,
		squadId: typeof query.squadId === "string" ? query.squadId : undefined,
		agentId: typeof query.agentId === "string" ? query.agentId : undefined,
		model: typeof query.model === "string" ? query.model : undefined,
	};
}

export { router as usageRouter };
