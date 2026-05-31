import { api } from '@/lib/api';
import { Activity, DollarSign, Layers, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
	Area,
	AreaChart,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';

interface UsageEntry {
	id: number;
	squadId: string | null;
	agentRole: string | null;
	model: string;
	inputTokens: number;
	outputTokens: number;
	estimatedCostUsd: number | null;
	timestamp: string;
}

interface UsageResponse {
	records: UsageEntry[];
	totals: {
		totalInputTokens: number;
		totalOutputTokens: number;
		totalCostUsd: number;
		callCount: number;
	};
}

const CHART_COLORS = ['#E43A9C', '#D83333', '#F041FF', '#38bdf8', '#a78bfa', '#34d399', '#f59e0b'];

export function UsageView() {
	const [data, setData] = useState<UsageResponse | null>(null);
	const [range, setRange] = useState('7d');

	useEffect(() => {
		const since = new Date();
		if (range === '7d') since.setDate(since.getDate() - 7);
		else if (range === '30d') since.setDate(since.getDate() - 30);
		else since.setDate(since.getDate() - 1);

		api
			.get<UsageResponse>(`/usage?since=${since.toISOString()}`)
			.then(setData)
			.catch(() => {});
	}, [range]);

	if (!data) {
		return (
			<div className="h-full flex items-center justify-center text-zinc-600">Loading...</div>
		);
	}

	// Aggregate by day for time chart
	const byDay = new Map<string, { date: string; tokens: number; cost: number }>();
	for (const entry of data.records) {
		const date = entry.timestamp.slice(0, 10);
		const existing = byDay.get(date) ?? { date, tokens: 0, cost: 0 };
		existing.tokens += entry.inputTokens + entry.outputTokens;
		existing.cost += entry.estimatedCostUsd ?? 0;
		byDay.set(date, existing);
	}
	const dailyData = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));

	// Aggregate by model for pie chart
	const byModel = new Map<string, number>();
	for (const entry of data.records) {
		byModel.set(
			entry.model,
			(byModel.get(entry.model) ?? 0) + entry.inputTokens + entry.outputTokens,
		);
	}
	const modelData = Array.from(byModel.entries()).map(([name, value]) => ({ name, value }));

	const totalTokens = data.totals.totalInputTokens + data.totals.totalOutputTokens;

	return (
		<div className="flex-1 overflow-y-auto p-6">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h2
						className="text-2xl tracking-wide text-zinc-100"
						style={{ fontFamily: "'Bebas Neue', sans-serif" }}
					>
						Usage
					</h2>
					<p className="text-[11px] text-zinc-600 font-mono mt-0.5">
						Token usage and cost tracking
					</p>
				</div>
				<div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.07]">
					{['1d', '7d', '30d'].map((r) => (
						<button
							key={r}
							type="button"
							onClick={() => setRange(r)}
							className={`px-3 py-1.5 rounded-lg text-[11px] font-mono transition-colors ${
								range === r
									? 'bg-white/10 text-zinc-200'
									: 'text-zinc-600 hover:text-zinc-400'
							}`}
						>
							{r}
						</button>
					))}
				</div>
			</div>

			{/* Summary cards */}
			<div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
				<SummaryCard
					icon={<Layers className="w-4 h-4 text-[#E43A9C]" />}
					label="Total Tokens"
					value={formatNumber(totalTokens)}
				/>
				<SummaryCard
					icon={<DollarSign className="w-4 h-4 text-emerald-400" />}
					label="Est. Cost"
					value={`$${data.totals.totalCostUsd.toFixed(4)}`}
				/>
				<SummaryCard
					icon={<Activity className="w-4 h-4 text-sky-400" />}
					label="API Calls"
					value={formatNumber(data.totals.callCount)}
				/>
				<SummaryCard
					icon={<Zap className="w-4 h-4 text-amber-400" />}
					label="Models Used"
					value={String(modelData.length)}
				/>
			</div>

			{/* Charts */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				{/* Daily usage chart */}
				<div className="lg:col-span-2 glass-card border border-white/[0.07] rounded-2xl p-5">
					<h3 className="text-sm font-mono text-zinc-400 mb-4">Tokens Over Time</h3>
					{dailyData.length > 0 ? (
						<ResponsiveContainer width="100%" height={250}>
							<AreaChart data={dailyData}>
								<defs>
									<linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
										<stop offset="5%" stopColor="#E43A9C" stopOpacity={0.3} />
										<stop offset="95%" stopColor="#E43A9C" stopOpacity={0} />
									</linearGradient>
								</defs>
								<XAxis
									dataKey="date"
									tick={{ fontSize: 10, fill: '#52525b', fontFamily: 'JetBrains Mono, monospace' }}
									axisLine={false}
									tickLine={false}
								/>
								<YAxis
									tick={{ fontSize: 10, fill: '#52525b', fontFamily: 'JetBrains Mono, monospace' }}
									axisLine={false}
									tickLine={false}
									tickFormatter={formatNumber}
								/>
								<Tooltip
									contentStyle={{
										background: '#222',
										border: '1px solid rgba(255,255,255,0.07)',
										borderRadius: '12px',
										fontSize: '11px',
										fontFamily: 'JetBrains Mono, monospace',
									}}
									labelStyle={{ color: '#71717a' }}
								/>
								<Area
									type="monotone"
									dataKey="tokens"
									stroke="#E43A9C"
									fill="url(#colorTokens)"
									strokeWidth={2}
								/>
							</AreaChart>
						</ResponsiveContainer>
					) : (
						<div className="h-[250px] flex items-center justify-center text-zinc-700 text-[11px] font-mono">
							No data for this period
						</div>
					)}
				</div>

				{/* Model breakdown */}
				<div className="glass-card border border-white/[0.07] rounded-2xl p-5">
					<h3 className="text-sm font-mono text-zinc-400 mb-4">By Model</h3>
					{modelData.length > 0 ? (
						<>
							<ResponsiveContainer width="100%" height={180}>
								<PieChart>
									<Pie
										data={modelData}
										dataKey="value"
										nameKey="name"
										cx="50%"
										cy="50%"
										outerRadius={70}
										strokeWidth={0}
									>
										{modelData.map((_, i) => (
											<Cell key={modelData[i]?.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
										))}
									</Pie>
									<Tooltip
										contentStyle={{
											background: '#222',
											border: '1px solid rgba(255,255,255,0.07)',
											borderRadius: '12px',
											fontSize: '11px',
											fontFamily: 'JetBrains Mono, monospace',
										}}
									/>
								</PieChart>
							</ResponsiveContainer>
							<div className="space-y-1.5 mt-3">
								{modelData.map((m, i) => (
									<div key={m.name} className="flex items-center gap-2 text-[11px] font-mono">
										<span
											className="w-2 h-2 rounded-full flex-shrink-0"
											style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
										/>
										<span className="text-zinc-500 truncate">{m.name}</span>
										<span className="ml-auto text-zinc-400">{formatNumber(m.value)}</span>
									</div>
								))}
							</div>
						</>
					) : (
						<div className="h-[180px] flex items-center justify-center text-zinc-700 text-[11px] font-mono">
							No data
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function SummaryCard({
	icon,
	label,
	value,
}: { icon: React.ReactNode; label: string; value: string }) {
	return (
		<div className="glass-card border border-white/[0.07] rounded-2xl p-4">
			<div className="flex items-center gap-2 mb-2">
				{icon}
				<p className="text-[11px] text-zinc-600 font-mono">{label}</p>
			</div>
			<p className="text-xl font-mono text-zinc-100">{value}</p>
		</div>
	);
}

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toString();
}
