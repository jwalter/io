import { Chip, PrimaryBtn, SecondaryBtn } from '@/components/ui/shared';
import { api } from '@/lib/api';
import { Plus, Search, Trash2, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Skill {
	name: string;
	activatedForOrchestrator: boolean;
	preview: string;
}

export function SkillsView() {
	const [skills, setSkills] = useState<Skill[]>([]);
	const [showInstall, setShowInstall] = useState(false);
	const [installUrl, setInstallUrl] = useState('');
	const [installName, setInstallName] = useState('');
	const [search, setSearch] = useState('');

	useEffect(() => {
		loadSkills();
	}, []);

	function loadSkills() {
		api
			.get<{ skills: Skill[] }>('/skills')
			.then((d) => setSkills(d.skills))
			.catch(() => {});
	}

	async function handleInstall() {
		if (!installName.trim() || !installUrl.trim()) return;
		try {
			await api.post('/skills/install', { name: installName, url: installUrl });
			toast.success(`Skill "${installName}" installed`);
			setShowInstall(false);
			setInstallUrl('');
			setInstallName('');
			loadSkills();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Install failed');
		}
	}

	async function handleRemove(name: string) {
		try {
			await api.delete(`/skills/${name}`);
			toast.success(`Skill "${name}" removed`);
			loadSkills();
		} catch {
			toast.error('Failed to remove skill');
		}
	}

	const filtered = skills.filter(
		(s) => !search || s.name.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<div className="flex-1 overflow-y-auto p-6">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h2
						className="text-2xl tracking-wide text-zinc-100"
						style={{ fontFamily: "'Bebas Neue', sans-serif" }}
					>
						Skills
					</h2>
					<p className="text-[11px] text-zinc-600 font-mono mt-0.5">
						{skills.length} installed capabilities
					</p>
				</div>
				<PrimaryBtn onClick={() => setShowInstall(true)} className="px-3 py-1.5">
					<Plus className="w-3.5 h-3.5" /> Install
				</PrimaryBtn>
			</div>

			{/* Search */}
			<div className="relative mb-4 max-w-sm">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
				<input
					type="text"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search skills..."
					className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-[11px] font-mono text-zinc-300 placeholder:text-zinc-700 outline-none focus:border-[#E43A9C]/50"
				/>
			</div>

			{/* Install form */}
			{showInstall && (
				<div className="glass-card border border-white/[0.07] rounded-2xl p-5 mb-5">
					<h3
						className="text-base tracking-wide text-zinc-200 mb-3"
						style={{ fontFamily: "'Bebas Neue', sans-serif" }}
					>
						Install Skill
					</h3>
					<div className="space-y-3">
						<input
							type="text"
							placeholder="Skill name"
							value={installName}
							onChange={(e) => setInstallName(e.target.value)}
							className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
						/>
						<input
							type="text"
							placeholder="URL to SKILL.md"
							value={installUrl}
							onChange={(e) => setInstallUrl(e.target.value)}
							className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] text-sm font-mono text-zinc-300 outline-none focus:border-[#E43A9C]/50"
						/>
						<div className="flex gap-2">
							<PrimaryBtn onClick={handleInstall} className="px-3 py-1.5">
								Install
							</PrimaryBtn>
							<SecondaryBtn onClick={() => setShowInstall(false)} className="px-3 py-1.5">
								Cancel
							</SecondaryBtn>
						</div>
					</div>
				</div>
			)}

			{/* Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
				{filtered.map((skill) => (
					<div
						key={skill.name}
						className="glass-card border border-white/[0.07] rounded-2xl p-4 group"
					>
						<div className="flex items-start justify-between">
							<div className="flex items-center gap-2">
								<div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#E43A9C]/10">
									<Zap size={14} className="text-[#E43A9C]" />
								</div>
								<h3 className="text-sm font-mono text-zinc-200">{skill.name}</h3>
							</div>
							<button
								type="button"
								onClick={() => handleRemove(skill.name)}
								className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-all"
							>
								<Trash2 size={13} />
							</button>
						</div>
						<p className="text-[11px] text-zinc-600 font-mono mt-2.5 line-clamp-3 leading-relaxed">
							{skill.preview}
						</p>
						{skill.activatedForOrchestrator && (
							<Chip variant="success" className="mt-2.5">
								Active
							</Chip>
						)}
					</div>
				))}
			</div>

			{filtered.length === 0 && !showInstall && (
				<div className="text-center py-12">
					<Zap size={48} className="mx-auto mb-3 text-zinc-800" />
					<p className="text-[11px] font-mono text-zinc-700">
						{search ? 'No skills match your search' : 'No skills installed. Click Install to add one.'}
					</p>
				</div>
			)}
		</div>
	);
}
