import { PrimaryBtn } from '@/components/ui/shared';
import { api } from '@/lib/api';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
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

type TabId = 'general' | 'telegram' | 'auth';

const TABS: { id: TabId; label: string }[] = [
	{ id: 'general', label: 'General' },
	{ id: 'telegram', label: 'Telegram' },
	{ id: 'auth', label: 'Auth' },
];

const INPUT_CLASS =
	'w-full max-w-[320px] rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2 text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50';

export function SettingsView() {
	const [config, setConfig] = useState<Config | null>(null);
	const [tab, setTab] = useState<TabId>('general');

	useEffect(() => {
		api
			.get<{ config: Config }>('/config')
			.then((d) => setConfig(d.config))
			.catch(() => {});
	}, []);

	function update(patch: Partial<Config>) {
		if (!config) return;
		setConfig({ ...config, ...patch });
	}

	async function save() {
		if (!config) return;
		try {
			const { dataDir: _dataDir, ...rest } = config;
			await api.patch('/config', rest);
			toast.success('Settings saved');
		} catch {
			toast.error('Failed to save settings');
		}
	}

	if (!config) {
		return (
			<div className="flex h-full items-center justify-center text-zinc-600">Loading...</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto p-6">
			<div className="max-w-3xl">
				<h2
					className="mb-6 text-2xl tracking-wide text-zinc-100"
					style={{ fontFamily: "'Bebas Neue', sans-serif" }}
				>
					Settings
				</h2>

				<div className="mb-6 flex gap-6 border-b border-white/[0.07]">
					{TABS.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => setTab(item.id)}
							className={`-mb-px border-b-2 px-1 pb-3 text-[11px] font-mono transition-colors ${
								tab === item.id
									? 'border-[#E43A9C] text-[#E43A9C]'
									: 'border-transparent text-zinc-500 hover:text-zinc-300'
							}`}
						>
							{item.label}
						</button>
					))}
				</div>

				<div className="glass-card rounded-2xl border border-white/[0.07] p-5">
					{tab === 'general' && (
						<>
							<FormRow label="Log Level">
								<select
									value={config.logLevel}
									onChange={(e) => update({ logLevel: e.target.value })}
									className={INPUT_CLASS}
								>
									{['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => (
										<option key={level} value={level}>
											{level}
										</option>
									))}
								</select>
							</FormRow>
							<FormRow label="Default Model">
								<input
									type="text"
									value={config.defaultModel}
									onChange={(e) => update({ defaultModel: e.target.value })}
									className={INPUT_CLASS}
								/>
							</FormRow>
							<FormRow label="Max Instances">
								<input
									type="number"
									value={config.maxInstancesPerSquad}
									onChange={(e) => update({ maxInstancesPerSquad: Number(e.target.value) })}
									className={INPUT_CLASS}
									min={1}
									max={10}
								/>
							</FormRow>
							<FormRow label="API Port">
								<input
									type="number"
									value={config.apiPort}
									onChange={(e) => update({ apiPort: Number(e.target.value) })}
									className={INPUT_CLASS}
								/>
							</FormRow>
							<FormRow label="Pricing Refresh">
								<input
									type="number"
									value={config.pricing.refreshIntervalHours}
									onChange={(e) =>
										update({ pricing: { refreshIntervalHours: Number(e.target.value) } })
									}
									className={INPUT_CLASS}
									min={1}
								/>
							</FormRow>
							<FormRow label="Data Dir">
								<input
									type="text"
									value={config.dataDir}
									readOnly
									className={`${INPUT_CLASS} cursor-default text-zinc-500`}
								/>
							</FormRow>
						</>
					)}

					{tab === 'telegram' && (
						<>
							<FormRow label="Bot Token">
								<MaskedInput
									value={config.telegram.botToken ?? ''}
									onChange={(value) =>
										update({ telegram: { ...config.telegram, botToken: value || null } })
									}
								/>
							</FormRow>
							<FormRow label="Allowed Chat IDs">
								<input
									type="text"
									value={config.telegram.allowedChatIds.join(', ')}
									onChange={(e) =>
										update({
											telegram: {
												...config.telegram,
												allowedChatIds: e.target.value
													.split(',')
													.map((segment) => Number(segment.trim()))
													.filter((value) => !Number.isNaN(value)),
											},
										})
									}
									className={INPUT_CLASS}
								/>
							</FormRow>
						</>
					)}

					{tab === 'auth' && (
						<>
							<FormRow label="Project URL">
								<input
									type="text"
									value={config.supabase.projectUrl ?? ''}
									onChange={(e) =>
										update({
											supabase: { ...config.supabase, projectUrl: e.target.value || null },
										})
									}
									className={INPUT_CLASS}
								/>
							</FormRow>
							<FormRow label="Anon Key">
								<MaskedInput
									value={config.supabase.anonKey ?? ''}
									onChange={(value) =>
										update({ supabase: { ...config.supabase, anonKey: value || null } })
									}
								/>
							</FormRow>
							<FormRow label="JWT Secret">
								<MaskedInput
									value={config.supabase.jwtSecret ?? ''}
									onChange={(value) =>
										update({ supabase: { ...config.supabase, jwtSecret: value || null } })
									}
								/>
							</FormRow>
						</>
					)}

					<div className="flex justify-end pt-6">
						<PrimaryBtn onClick={save} className="px-4 py-2.5">
							Save Settings
						</PrimaryBtn>
					</div>
				</div>
			</div>
		</div>
	);
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-6 border-b border-white/[0.07] py-3">
			<label className="text-[11px] font-mono text-zinc-400">{label}</label>
			<div className="w-full max-w-[320px] shrink-0">{children}</div>
		</div>
	);
}

function MaskedInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	const [visible, setVisible] = useState(false);

	return (
		<div className="relative">
			<input
				type={visible ? 'text' : 'password'}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className={`${INPUT_CLASS} pr-9`}
			/>
			<button
				type="button"
				onClick={() => setVisible((current) => !current)}
				className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors hover:text-zinc-400"
				aria-label={visible ? 'Hide value' : 'Show value'}
			>
				{visible ? <EyeOff size={14} /> : <Eye size={14} />}
			</button>
		</div>
	);
}
