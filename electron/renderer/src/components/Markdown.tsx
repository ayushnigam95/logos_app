/**
 * Minimal Markdown renderer for chat output.
 *
 * Supports: bold (**), italic (*), inline code (`), headings (#..######),
 * bullet lists (- / *), numbered lists (1.), paragraphs, blank-line breaks.
 * HTML in the source is always escaped — no raw HTML, no images, no links.
 * Good enough for LLM chat replies; not a full CommonMark implementation.
 */
import * as React from 'react';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text: string): string {
  // Order matters: code first so its contents aren't reformatted.
  let s = escapeHtml(text);
  // Inline code `foo`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold **foo**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic *foo* (avoid swallowing remaining `**`)
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return s;
}

interface Block {
  type: 'p' | 'h' | 'ul' | 'ol' | 'pre';
  level?: number;
  items?: string[];
  text?: string;
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Skip blank lines
    if (!line.trim()) {
      i++;
      continue;
    }
    // Fenced code block
    if (/^```/.test(line)) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push({ type: 'pre', text: buf.join('\n') });
      continue;
    }
    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: 'h', level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }
    // Paragraph: gather contiguous non-blank, non-special lines
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', text: buf.join(' ') });
  }
  return blocks;
}

export function Markdown({ source }: { source: string }): React.ReactElement {
  const html = React.useMemo(() => {
    const blocks = parseBlocks(source ?? '');
    return blocks
      .map((b) => {
        switch (b.type) {
          case 'h': {
            const lvl = Math.min(Math.max(b.level ?? 1, 1), 6);
            return `<h${lvl}>${renderInline(b.text ?? '')}</h${lvl}>`;
          }
          case 'ul':
            return `<ul>${(b.items ?? []).map((it) => `<li>${renderInline(it)}</li>`).join('')}</ul>`;
          case 'ol':
            return `<ol>${(b.items ?? []).map((it) => `<li>${renderInline(it)}</li>`).join('')}</ol>`;
          case 'pre':
            return `<pre><code>${escapeHtml(b.text ?? '')}</code></pre>`;
          case 'p':
          default:
            return `<p>${renderInline(b.text ?? '')}</p>`;
        }
      })
      .join('');
  }, [source]);

  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
