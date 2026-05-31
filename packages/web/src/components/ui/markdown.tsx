import { marked } from 'marked';
import { useMemo } from 'react';

const GRADIENT_STYLE =
	'linear-gradient(135deg, #D83333 0%, #E43A9C 50%, #F041FF 100%)';

marked.use({
	renderer: {
		heading({ tokens, depth }: { tokens: { raw: string }[]; depth: number }) {
			const text = tokens.map((t: { raw: string }) => t.raw).join('');
			const tag = `h${depth}`;
			const sizes: Record<number, string> = {
				1: '1.35em',
				2: '1.15em',
				3: '1em',
				4: '0.9em',
			};
			return `<${tag} style="background:${GRADIENT_STYLE};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-size:${sizes[depth] ?? '1em'};font-weight:600;margin:1.1em 0 0.4em;">${text}</${tag}>`;
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
