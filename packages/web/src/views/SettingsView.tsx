import { PrimaryBtn } from '@/components/ui/shared';
import { api } from '@/lib/api';
import { Eye, EyeOff, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Config {
	apiPort: number;
	logLevel: string;
	defaultModel: string;
	maxInstancesPerSquad: number;
	dataDir: string;
	pricing: { refreshIntervalHours: number };
	telegram: { botToken: string | null; allowedChatIds: number[] };
	supabase: { projectUrl: string | null; anonKey: string | null; jwtSecret: string | null };
}

type TabId = 'general' | 'telegram' | 'auth' | 'models' | 'advanced';

export function SettingsView() {
	const [config, setConfig] = useState<Config | null>(null);
	const [tab, setTab] = useState<TabId>('general');
	const [dirty, setDirty] = useState(false);

	useEffect(() => {
		api
			.get<{ config: Config }>('/config')
			.then((d) => setConfig(d.config))
			.catch(() => {});
	}, []);

	function update(patch: Partial<Config>) {
		if (!config) return;
		setConfig({ ...config, ...patch });
		setDirty(true);
	}

	async function save() {
		if (!config) return;
		try {
			const { dataDir: _, ...rest } = config;
			await api.patch('/config', rest);
			toast.success('Settings saved');
			setDirty(false);
		} catch {
			toast.error('Failed to save settings');
		}
	}

	if (!config) {
		return (
			<div className="h-full flex items-center justify-center text-zinc-600">Loading...</div>
		);
	}

	const TABS: { id: TabId; label: string }[] = [
		{ id: 'general', label: 'General' },
		{ id: 'telegram', label: 'Telegram' },
		{ id: 'auth', label: 'Auth' },
		{ id: 'models', label: 'Models' },
		{ id: 'advanced', label: 'Advanced' },
	];

	return (
		<div className="flex-1 overflow-y-auto p-6">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h2
						className="text-2xl tracking-wide text-zinc-100"
						style={{ fontFamily: "'Bebas Neue', sans-serif" }}
					>
						Settings
					</h2>
					<p className="text-[11px] text-zinc-600 font-mono mt-0.5">
						Configure IO daemon behavior
					</p>
				</div>
				{dirty && (
					<PrimaryBtn onClick={save} className="px-3 py-1.5">
						<Save className="w-3.5 h-3.5" /> Save Changes
					</PrimaryBtn>
				)}
			</div>

			{/* Tabs */}
			<div className="flex gap-1 mb-6 p-1 rounded-xl bg-white/[0.03] border border-white/[0.07] w-fit">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setTab(t.id)}
						className={`px-4 py-1.5 rounded-lg text-[11px] font-mono transition-colors ${
							tab === t.id
								? 'bg-white/10 text-zinc-200'
								: 'text-zinc-600 hover:text-zinc-400'
						}`}
					>
						{t.label}
					</button>
				))}
			</div>

			{/* Content */}
			<div className="glass-card border border-white/[0.07] rounded-2xl p-6 max-w-2xl">
				{tab === 'general' && (
					<div className="space-y-5">
						<Field label="Log Level">
							<select
								value={config.logLevel}
								onChange={(e) => update({ logLevel: e.target.value })}
								className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
							>
								{['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((l) => (
									<option key={l} value={l}>
										{l}
									</option>
								))}
							</select>
						</Field>
						<Field label="Default Model">
							<input
								type="text"
								value={config.defaultModel}
								onChange={(e) => update({ defaultModel: e.target.value })}
								className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
							/>
						</Field>
						<Field label="Max Instances Per Squad">
							<input
								type="number"
								value={config.maxInstancesPerSquad}
								onChange={(e) => update({ maxInstancesPerSquad: Number(e.target.value) })}
								className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
								min={1}
								max={10}
							/>
						</Field>
						<Field label="API Port">
							<input
								type="number"
								value={config.apiPort}
								onChange={(e) => update({ apiPort: Number(e.target.value) })}
								className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
							/>
						</Field>
					</div>
				)}

				{tab === 'telegram' && (
					<div className="space-y-5">
						<Field label="Bot Token">
							<MaskedInput
								value={config.telegram.botToken ?? ''}
								onChange={(v) =>
									update({ telegram: { ...config.telegram, botToken: v || null } })
								}
								placeholder="Enter Telegram bot token"
							/>
						</Field>
						<Field label="Allowed Chat IDs (comma-separated)">
							<input
								type="text"
								value={config.telegram.allowedChatIds.join(', ')}
								onChange={(e) =>
									update({
										telegram: {
											...config.telegram,
											allowedChatIds: e.target.value
												.split(',')
												.map((s) => Number(s.trim()))
												.filter((n) => !Number.isNaN(n)),
										},
									})
								}
								className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
							/>
						</Field>
					</div>
				)}

				{tab === 'auth' && (
					<div className="space-y-5">
						<Field label="Supabase Project URL">
							<input
								type="text"
								value={config.supabase.projectUrl ?? ''}
								onChange={(e) =>
									update({ supabase: { ...config.supabase, projectUrl: e.target.value || null } })
								}
								placeholder="https://your-project.supabase.co"
								className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
							/>
						</Field>
						<Field label="Supabase Anon Key">
							<MaskedInput
								value={config.supabase.anonKey ?? ''}
								onChange={(v) =>
									update({ supabase: { ...config.supabase, anonKey: v || null } })
								}
								placeholder="eyJhbGciOiJIUzI1NiIs..."
							/>
						</Field>
						<Field label="JWT Secret">
							<MaskedInput
								value={config.supabase.jwtSecret ?? ''}
								onChange={(v) =>
									update({ supabase: { ...config.supabase, jwtSecret: v || null } })
								}
								placeholder="your-jwt-secret"
							/>
						</Field>
						<p className="text-[11px] text-zinc-600 font-mono leading-relaxed">
							When configured, the web dashboard requires Supabase authentication to access. The JWT
							Secret is used to verify tokens server-side — find it in Supabase project settings →
							API → JWT Settings.
						</p>
					</div>
				)}

				{tab === 'models' && (
					<div className="space-y-5">
						<Field label="Pricing Refresh Interval (hours)">
							<input
								type="number"
								value={config.pricing.refreshIntervalHours}
								onChange={(e) =>
									update({ pricing: { refreshIntervalHours: Number(e.target.value) } })
								}
								className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
								min={1}
							/>
						</Field>
						<p className="text-[11px] text-zinc-600 font-mono leading-relaxed">
							Model pricing is auto-refreshed from GitHub docs at this interval.
						</p>
					</div>
				)}

				{tab === 'advanced' && (
					<div className="space-y-5">
						<Field label="Data Directory">
							<input
								type="text"
								value={config.dataDir}
								disabled
								className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-500 outline-none cursor-not-allowed"
							/>
							<p className="text-[11px] text-zinc-700 font-mono mt-1">
								Cannot be changed while daemon is running.
							</p>
						</Field>
					</div>
				)}
			</div>
		</div>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<label className="block text-[11px] font-mono text-zinc-400 mb-1.5">{label}</label>
			{children}
		</div>
	);
}

function MaskedInput({
	value,
	onChange,
	placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<input
				type={visible ? 'text' : 'password'}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="w-full px-3 py-2 pr-9 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
			/>
			<button
				type="button"
				onClick={() => setVisible(!visible)}
				className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
			>
				{visible ? <EyeOff size={14} /> : <Eye size={14} />}
			</button>
		</div>
	);
}
