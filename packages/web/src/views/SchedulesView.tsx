import { Chip, PrimaryBtn, SecondaryBtn } from '@/components/ui/shared';
import { api } from '@/lib/api';
import { Calendar, Clock, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Schedule {
	id: string;
	name: string;
	targetType: 'squad' | 'orchestrator';
	targetId: string | null;
	cron: string;
	prompt: string;
	enabled: boolean;
	lastRun: string | null;
	nextRun: string | null;
}

export function SchedulesView() {
	const [schedules, setSchedules] = useState<Schedule[]>([]);
	const [tab, setTab] = useState<'all' | 'squad' | 'orchestrator'>('all');
	const [showCreate, setShowCreate] = useState(false);
	const [form, setForm] = useState({
		name: '',
		cron: '',
		prompt: '',
		targetType: 'orchestrator' as const,
	});

	useEffect(() => {
		loadSchedules();
	}, []);

	function loadSchedules() {
		api
			.get<{ schedules: Schedule[] }>('/schedules')
			.then((d) => setSchedules(d.schedules))
			.catch(() => {});
	}

	const filtered = schedules.filter((s) => tab === 'all' || s.targetType === tab);

	async function handleCreate() {
		if (!form.name || !form.cron || !form.prompt) return;
		try {
			await api.post('/schedules', form);
			toast.success(`Schedule "${form.name}" created`);
			setShowCreate(false);
			setForm({ name: '', cron: '', prompt: '', targetType: 'orchestrator' });
			loadSchedules();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create');
		}
	}

	async function handleToggle(id: string, enabled: boolean) {
		try {
			await api.patch(`/schedules/${id}`, { enabled: !enabled });
			loadSchedules();
		} catch {
			toast.error('Failed to toggle schedule');
		}
	}

	async function handleDelete(id: string) {
		try {
			await api.delete(`/schedules/${id}`);
			toast.success('Schedule deleted');
			loadSchedules();
		} catch {
			toast.error('Failed to delete');
		}
	}

	return (
		<div className="flex-1 overflow-y-auto p-6">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h2
						className="text-2xl tracking-wide text-zinc-100"
						style={{ fontFamily: "'Bebas Neue', sans-serif" }}
					>
						Schedules
					</h2>
					<p className="text-[11px] text-zinc-600 font-mono mt-0.5">
						{schedules.length} automated tasks · {schedules.filter((s) => s.enabled).length}{' '}
						active
					</p>
				</div>
				<PrimaryBtn onClick={() => setShowCreate(true)} className="px-3 py-1.5">
					<Plus className="w-3.5 h-3.5" /> New Schedule
				</PrimaryBtn>
			</div>

			{/* Tabs */}
			<div className="flex gap-1 mb-5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.07] w-fit">
				{(['all', 'orchestrator', 'squad'] as const).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						className={`px-3 py-1.5 rounded-lg text-[11px] font-mono transition-colors ${
							tab === t
								? 'bg-white/10 text-zinc-200'
								: 'text-zinc-600 hover:text-zinc-400'
						}`}
					>
						{t === 'all' ? 'All' : t === 'orchestrator' ? 'IO' : 'Squad'}
					</button>
				))}
			</div>

			{/* Create form */}
			{showCreate && (
				<div className="glass-card border border-white/[0.07] rounded-2xl p-5 mb-5">
					<h3
						className="text-base tracking-wide text-zinc-200 mb-3"
						style={{ fontFamily: "'Bebas Neue', sans-serif" }}
					>
						New Schedule
					</h3>
					<div className="space-y-3">
						<input
							type="text"
							placeholder="Name"
							value={form.name}
							onChange={(e) => setForm({ ...form, name: e.target.value })}
							className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
						/>
						<input
							type="text"
							placeholder="Cron expression (e.g. 0 9 * * 1-5)"
							value={form.cron}
							onChange={(e) => setForm({ ...form, cron: e.target.value })}
							className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
						/>
						<textarea
							placeholder="Prompt to execute"
							value={form.prompt}
							onChange={(e) => setForm({ ...form, prompt: e.target.value })}
							rows={3}
							className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50 resize-none"
						/>
						<div className="flex gap-2">
							<PrimaryBtn onClick={handleCreate} className="px-3 py-1.5">
								Create
							</PrimaryBtn>
							<SecondaryBtn onClick={() => setShowCreate(false)} className="px-3 py-1.5">
								Cancel
							</SecondaryBtn>
						</div>
					</div>
				</div>
			)}

			{/* List */}
			<div className="space-y-2">
				{filtered.map((sched) => (
					<div
						key={sched.id}
						className="glass-card border border-white/[0.07] rounded-2xl p-4 flex items-center gap-4 group"
					>
						<div
							className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
								sched.enabled ? 'bg-[#E43A9C]/10' : 'bg-white/[0.04]'
							}`}
						>
							<Calendar
								size={14}
								className={sched.enabled ? 'text-[#E43A9C]' : 'text-zinc-600'}
							/>
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="text-sm font-mono text-zinc-200">{sched.name}</span>
								<Chip variant={sched.targetType === 'orchestrator' ? 'info' : 'default'}>
									{sched.targetType === 'orchestrator' ? 'IO' : 'Squad'}
								</Chip>
								{!sched.enabled && <Chip variant="warning">Paused</Chip>}
							</div>
							<p className="text-[11px] text-zinc-600 font-mono mt-0.5">{sched.cron}</p>
							<p className="text-[11px] text-zinc-700 mt-0.5 truncate max-w-md">
								{sched.prompt}
							</p>
							{sched.nextRun && (
								<p className="text-[10px] text-zinc-700 font-mono mt-1 flex items-center gap-1">
									<Clock size={10} /> Next: {new Date(sched.nextRun).toLocaleString()}
								</p>
							)}
						</div>
						<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button
								type="button"
								onClick={() => handleToggle(sched.id, sched.enabled)}
								className={`p-1.5 rounded-lg transition-colors ${
									sched.enabled
										? 'text-emerald-400 hover:bg-emerald-400/10'
										: 'text-zinc-600 hover:bg-white/[0.04]'
								}`}
								title={sched.enabled ? 'Pause' : 'Resume'}
							>
								{sched.enabled ? <Pause size={13} /> : <Play size={13} />}
							</button>
							<button
								type="button"
								onClick={() => handleDelete(sched.id)}
								className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-colors"
							>
								<Trash2 size={13} />
							</button>
						</div>
					</div>
				))}
			</div>

			{filtered.length === 0 && (
				<div className="text-center py-12">
					<Calendar size={48} className="mx-auto mb-3 text-zinc-800" />
					<p className="text-[11px] font-mono text-zinc-700">
						No schedules. Click New Schedule to create one.
					</p>
				</div>
			)}
		</div>
	);
}
