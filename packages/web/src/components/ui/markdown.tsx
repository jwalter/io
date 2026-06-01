import { marked } from 'marked';
import { useMemo } from 'react';

marked.use({
	renderer: {
		heading({ tokens, depth }: { tokens: { raw: string }[]; depth: number }) {
			const text = tokens.map((t: { raw: string }) => t.raw).join('');
			const tag = `h${depth}`;
			const sizes: Record<number, string> = {
				1: '1.5rem',
				2: '1.25rem',
				3: '1.125rem',
				4: '1rem',
			};
			return `<${tag} style="font-size:${sizes[depth] ?? '1rem'};font-weight:500;color:#e4e4e7;margin:1.1em 0 0.4em;line-height:1.5;">${text}</${tag}>`;
		},
	},
});

export function MarkdownRenderer({
	content,
	className = '',
}: { content: string; className?: string }) {
	const html = useMemo(() => marked.parse(content) as string, [content]);
	return (
		<div
			className={`prose-io ${className}`}
			style={{ color: '#d4d4d8', fontSize: '0.875rem', lineHeight: '1.7' }}
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
