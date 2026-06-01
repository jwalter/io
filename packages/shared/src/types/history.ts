export type WorkEventKind = 'thought' | 'tool_call' | 'tool_result' | 'message' | 'decision';

export interface WorkEvent {
	id: number;
	kind: WorkEventKind;
	timestamp: string;
	label?: string;
	content: string;
	status?: 'ok' | 'error';
}

export interface AgentHistoryEntry {
	agentId: string;
	agentName: string;
	role: string;
	roleType?: 'lead' | 'qa' | 'scribe' | 'default';
	summary: string;
	events: WorkEvent[];
}

export type HistoryActivityStatus = 'completed' | 'errored';
export type HistoryActivityType = 'instance' | 'delegation';

export interface HistoryActivity {
	id: string;
	title: string;
	type: HistoryActivityType;
	status: HistoryActivityStatus;
	createdAt: string;
	completedAt: string;
	duration: string;
	agentCount: number;
}

export interface HistoryActivityDetail extends HistoryActivity {
	agentEntries: AgentHistoryEntry[];
}
