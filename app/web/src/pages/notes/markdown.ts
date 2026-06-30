// A deliberately tiny markdown → HTML renderer for the note preview. No new
// dependency: notes are single-user, self-hosted content. We HTML-escape first
// so raw markup can never inject elements; only the tags this renderer emits
// reach the DOM, and link hrefs are restricted to safe schemes.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeHref(url: string): string {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(url.trim()) ? url.trim() : '#';
}

// Inline spans on an already HTML-escaped string.
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
      return `<a href="${safeHref(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
}

// Scoped styling for rendered markdown — Tailwind's preflight strips default
// heading/list styling, so the preview needs explicit rules. Rendered once via a
// <style> tag inside the preview pane to avoid touching the global stylesheet.
export const MARKDOWN_CSS = `
.markdown { color: #e4e4e7; line-height: 1.6; word-wrap: break-word; }
.markdown > *:first-child { margin-top: 0; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 { font-weight: 600; color: #fafafa; margin: 0.9em 0 0.4em; line-height: 1.3; }
.markdown h1 { font-size: 1.5rem; border-bottom: 1px solid #27272a; padding-bottom: 0.2em; }
.markdown h2 { font-size: 1.25rem; border-bottom: 1px solid #27272a; padding-bottom: 0.2em; }
.markdown h3 { font-size: 1.1rem; }
.markdown p { margin: 0.5em 0; }
.markdown a { color: #fb923c; text-decoration: underline; }
.markdown strong { font-weight: 600; color: #f4f4f5; }
.markdown ul, .markdown ol { margin: 0.5em 0; padding-left: 1.5em; }
.markdown ul { list-style: disc; }
.markdown ol { list-style: decimal; }
.markdown li { margin: 0.2em 0; }
.markdown code { background: #27272a; padding: 0.1em 0.35em; border-radius: 0.25rem; font-size: 0.85em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.markdown pre { background: #09090b; border: 1px solid #27272a; border-radius: 0.5rem; padding: 0.75rem; overflow: auto; margin: 0.6em 0; }
.markdown pre code { background: transparent; padding: 0; font-size: 0.85em; }
.markdown blockquote { border-left: 3px solid #f97316; padding-left: 0.75rem; color: #a1a1aa; margin: 0.6em 0; }
.markdown hr { border: 0; border-top: 1px solid #27272a; margin: 1em 0; }
`;

const LIST_RE = /^\s*([-*+]|\d+\.)\s+(.*)$/;

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(escapeHtml(para.join(' ')))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      out.push('<hr />');
      i++;
      continue;
    }

    // Blockquote (consecutive lines)
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(escapeHtml(quote.join(' ')))}</blockquote>`);
      continue;
    }

    // List (group consecutive items; ordered if the first marker is numeric)
    if (LIST_RE.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        const m = LIST_RE.exec(lines[i])!;
        items.push(`<li>${inline(escapeHtml(m[2]))}</li>`);
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Blank line ends a paragraph
    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }

  flushPara();
  return out.join('\n');
}
