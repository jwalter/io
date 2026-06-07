import { useMemo } from "react";
import { marked } from "marked";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  const html = useMemo(() => {
    const renderer = new marked.Renderer();
    renderer.link = ({ href, title, text }) => {
      return `<a href="${href}" title="${title ?? ""}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    };
    return marked(content, { renderer, async: false }) as string;
  }, [content]);

  return (
    <div
      className={`prose prose-invert max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
