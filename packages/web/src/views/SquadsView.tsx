import { Chip, statusToVariant } from '@/components/ui/shared';
import { api } from '@/lib/api';
import {
	Bot,
	Bug,
	ChevronLeft,
	Crown,
	Cpu,
	ExternalLink,
	ScrollText,
	Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

// Auto-assign colors to squads
const SQUAD_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#f59e0b', '#f87171', '#E43A9C'];
function squadColor(index: number): string {
	return SQUAD_COLORS[index % SQUAD_COLORS.length] as string;
}

interface SquadSummary {
	id: string;
	name: string;
	universe: string;
	repoUrl: string;
	status: string;
	memberCount: number;
	activeInstances: number;
	totalInstances: number;
	createdAt: string;
}

interface AppConfig {
	maxInstancesPerSquad: number;
}

interface SquadMember {
	id: string;
	displayName: string;
	role: string;
	roleName?: string;
	persona: string | null;
	veto: boolean;
	status: string;
	currentTask: string | null;
}

interface SquadDetail {
	squad: {
		id: string;
		name: string;
		universe: string;
		repoUrl: string;
		status: string;
		autonomyTier: string;
		createdAt: string;
	};
	members: SquadMember[];
	instances: Array<{
		id: string;
		status: string;
		issueRef: string | null;
		branch: string | null;
		taskCount: number;
		tasksComplete: number;
	}>;
}

export function SquadsView() {
	const { name } = useParams<{ name: string }>();

	if (name) {
		return <SquadDetailView name={name} />;
	}

	return <SquadListView />;
}

function SquadListView() {
	const [squads, setSquads] = useState<SquadSummary[]>([]);
	const [maxInstancesPerSquad, setMaxInstancesPerSquad] = useState<number | null>(null);
	const navigate = useNavigate();

	useEffect(() => {
		Promise.all([
			api.get<{ squads: SquadSummary[] }>('/squads'),
			api.get<{ config: AppConfig }>('/config'),
		])
			.then(([squadsResponse, configResponse]) => {
				setSquads(squadsResponse.squads);
				setMaxInstancesPerSquad(configResponse.config.maxInstancesPerSquad);
			})
			.catch(() => {});
	}, []);

	return (
		<div className="flex-1 overflow-y-auto p-6">
			<div className="mb-6">
				<div>
					<h2
						className="text-2xl tracking-wide text-zinc-100"
						style={{ fontFamily: "'Bebas Neue', sans-serif" }}
					>
						Squads
					</h2>
					<p className="text-[11px] text-zinc-600 font-mono mt-0.5">
						{squads.length} squads · {squads.reduce((a, s) => a + (s.activeInstances || 0), 0)}{' '}
						active instances
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
				{squads.map((squad, idx) => {
					const color = squadColor(idx);
					return (
						<button
							type="button"
							key={squad.id}
							onClick={() => navigate(`/squads/${squad.name}`)}
							className="text-left rounded-2xl p-5 transition-all group cursor-pointer"
							style={{
								border: `1px solid ${color}30`,
								background: `${color}08`,
								backdropFilter: 'blur(20px)',
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.borderColor = `${color}70`;
								e.currentTarget.style.background = `${color}12`;
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.borderColor = `${color}30`;
								e.currentTarget.style.background = `${color}08`;
							}}
						>
							<div className="flex items-start justify-between mb-1">
								<h3 className="text-sm font-mono transition-colors" style={{ color }}>
									{squad.name}
								</h3>
								<Chip variant={statusToVariant(squad.status)}>{squad.status}</Chip>
							</div>
							<div className="flex items-center justify-between mb-3">
								<p className="text-[11px] text-zinc-600 font-mono">{squad.universe}</p>
								<span className="text-[11px] text-zinc-600 font-mono flex items-center gap-1">
									<Cpu className="w-3 h-3" />
									{squad.activeInstances}/{maxInstancesPerSquad ?? (squad.totalInstances || squad.memberCount)}
								</span>
							</div>
							{squad.repoUrl && (
								<div className="flex items-center gap-1.5 text-[11px] text-zinc-700 font-mono">
									<ExternalLink className="w-3 h-3 flex-shrink-0" />
									<span className="truncate">
										{squad.repoUrl.replace('https://github.com/', '')}
									</span>
								</div>
							)}
						</button>
					);
				})}

				{squads.length === 0 && (
					<div className="col-span-full text-center py-12 text-zinc-600">
						<Users size={48} className="mx-auto mb-3 opacity-30" />
						<p className="text-[11px] font-mono">
							No squads hired yet. Ask IO to hire a squad for a project.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

function roleIcon(roleName: string, color: string) {
	const cls = 'w-4 h-4';
	const style = { color };
	const lower = roleName.toLowerCase();
	if (lower.includes('lead') || lower.includes('pm') || lower.includes('technical'))
		return <Crown className={cls} style={style} />;
	if (lower.includes('qa') || lower.includes('test'))
		return <Bug className={cls} style={style} />;
	if (lower.includes('scribe'))
		return <ScrollText className={cls} style={style} />;
	return <Bot className={cls} style={style} />;
}

function SquadDetailView({ name }: { name: string }) {
	const [detail, setDetail] = useState<SquadDetail | null>(null);
	const navigate = useNavigate();

	useEffect(() => {
		api
			.get<SquadDetail>(`/squads/${name}`)
			.then(setDetail)
			.catch(() => {});
	}, [name]);

	if (!detail) {
		return (
			<div className="h-full flex items-center justify-center text-zinc-600">Loading...</div>
		);
	}

	const color = SQUAD_COLORS[0]; // Could be stored per-squad

	return (
		<div className="flex-1 overflow-y-auto p-6">
			<button
				type="button"
				onClick={() => navigate('/squads')}
				className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-zinc-300 font-mono mb-5 transition-colors"
			>
				<ChevronLeft className="w-3.5 h-3.5" /> Back to Squads
			</button>

			<div className="flex items-start justify-between mb-6">
				<div>
					<h2
						className="text-2xl tracking-wide"
						style={{ fontFamily: "'Bebas Neue', sans-serif", color }}
					>
						{detail.squad.name}
					</h2>
					<p className="text-[11px] text-zinc-600 font-mono mt-0.5">
						{detail.squad.universe} · {detail.squad.autonomyTier || 'standard'} autonomy
					</p>
					{detail.squad.repoUrl && (
						<a
							href={detail.squad.repoUrl}
							target="_blank"
							rel="noreferrer"
							className="text-[11px] font-mono text-zinc-700 hover:text-zinc-400 flex items-center gap-1 mt-1 transition-colors"
						>
							<ExternalLink className="w-3 h-3" />
							{detail.squad.repoUrl.replace('https://github.com/', '')}
						</a>
					)}
				</div>
				<Chip variant={statusToVariant(detail.squad.status)}>{detail.squad.status}</Chip>
			</div>

			{/* Agent roster */}
			<div className="space-y-2 mb-8">
				{detail.members.map((agent) => (
					<div
						key={agent.id}
						className="glass-card border border-white/[0.07] rounded-2xl p-4 flex items-center gap-3"
					>
						<div
							className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
							style={{ border: `1px solid ${color}30`, background: `${color}12` }}
						>
							{roleIcon(agent.roleName || agent.role, color as string)}
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="text-sm font-mono text-zinc-200">{agent.displayName}</span>
								<Chip variant={statusToVariant(agent.status)}>{agent.status}</Chip>
							</div>
							<p className="text-[11px] text-zinc-600 font-mono mt-0.5">{agent.role}</p>
							{agent.currentTask && (
								<p className="text-xs text-zinc-500 mt-1 truncate">{agent.currentTask}</p>
							)}
						</div>
					</div>
				))}
			</div>

			{/* Instances */}
			{detail.instances.length > 0 && (
				<section>
					<h3
						className="text-lg tracking-wide mb-3"
						style={{ fontFamily: "'Bebas Neue', sans-serif", color }}
					>
						Instances
					</h3>
					<div className="space-y-2">
						{detail.instances.map((inst) => (
							<div
								key={inst.id}
								className="glass-card border border-white/[0.07] rounded-2xl p-4"
							>
								<div className="flex items-center justify-between">
									<span className="text-[11px] font-mono text-zinc-400">
										{inst.id.slice(0, 8)}
									</span>
									<Chip variant={statusToVariant(inst.status)}>{inst.status}</Chip>
								</div>
								<div className="mt-2 text-[11px] text-zinc-600 font-mono flex gap-4">
									<span>
										Tasks: {inst.tasksComplete}/{inst.taskCount}
									</span>
									{inst.branch && <span>Branch: {inst.branch}</span>}
								</div>
							</div>
						))}
					</div>
				</section>
			)}
		</div>
	);
}
