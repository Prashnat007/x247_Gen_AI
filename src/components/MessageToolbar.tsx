import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Copy, Check, FileText, FileCode, Printer, Braces } from 'lucide-react';

interface Props {
  messageId: string;
  content: string;
  meta?: { agents?: string[]; durationMs?: number; ts?: string };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length === 0) return;
    const text = paraBuf.join(' ').trim();
    if (text) out.push(`<p>${inline(text)}</p>`);
    paraBuf = [];
  };
  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };
  const openList = (t: 'ul' | 'ol') => {
    if (listType !== t) { closeList(); out.push(`<${t}>`); listType = t; }
  };
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushPara(); closeList(); continue; }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.+)$/))) {
      flushPara(); closeList();
      const lvl = Math.min(6, m[1].length);
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.+)$/))) {
      flushPara(); openList('ul');
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if ((m = line.match(/^\s*\d+\.\s+(.+)$/))) {
      flushPara(); openList('ol');
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if (/^>\s+/.test(line)) {
      flushPara(); closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s+/, ''))}</blockquote>`);
      continue;
    }
    closeList();
    paraBuf.push(line);
  }
  flushPara(); closeList();
  return out.join('\n');
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const HTML_FRAME = (title: string, body: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 24px;color:#1a1a1a;line-height:1.65;}
h1,h2,h3{color:#4f46e5;margin-top:1.6em;}
h1{border-bottom:2px solid #e5e7eb;padding-bottom:6px;}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:0.9em;}
pre{background:#1f2937;color:#f3f4f6;padding:14px;border-radius:8px;overflow-x:auto;}
ul,ol{padding-left:24px;}
li{margin:4px 0;}
.meta{color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;padding-bottom:14px;margin-bottom:24px;}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:6px;}
.brand-logo{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;}
strong{color:#111827;}
blockquote{border-left:4px solid #6366f1;padding:6px 14px;background:#f9fafb;margin:12px 0;color:#374151;}
@media print {body{margin:0;padding:20px;}}
</style></head><body>
<div class="brand"><div class="brand-logo">R</div><div><div style="font-weight:800;font-size:18px;">Recall X247</div><div style="color:#6b7280;font-size:12px;">Neural AI Orchestrator</div></div></div>
<div class="meta">${title}</div>
${body}
</body></html>`;

export const MessageToolbar: React.FC<Props> = ({ messageId, content, meta }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    // Compute viewport-anchored position for the portal so chat overflow can't clip it.
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      const menuW = 200;
      const menuH = 230; // approx 5 items * 36 + padding
      const left = Math.min(rect.right - menuW, window.innerWidth - menuW - 8);
      const wantBelow = rect.bottom + 6;
      const flipUp = wantBelow + menuH > window.innerHeight - 8;
      const top = flipUp ? Math.max(8, rect.top - menuH - 6) : wantBelow;
      setPos({ top, left: Math.max(8, left) });
    }
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        // Return focus to trigger button for keyboard users.
        (ref.current?.querySelector('button') as HTMLButtonElement | null)?.focus();
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const ts = meta?.ts ? new Date(meta.ts).toLocaleString() : new Date().toLocaleString();
  const agentsLine = meta?.agents?.length ? `Agents: ${meta.agents.join(' › ')}` : '';
  const headerLine = `Recall X247 · ${ts}${agentsLine ? ' · ' + agentsLine : ''}`;

  const copy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setOpen(false);
  };

  const exportMd = () => {
    const md = `# ${headerLine}\n\n${content}\n`;
    downloadFile(`recall-${messageId}.md`, md, 'text/markdown');
    setOpen(false);
  };

  const exportHtml = () => {
    downloadFile(`recall-${messageId}.html`, HTML_FRAME(headerLine, mdToHtml(content)), 'text/html');
    setOpen(false);
  };

  const exportJson = () => {
    const json = JSON.stringify({ id: messageId, content, ...meta, exported_at: new Date().toISOString() }, null, 2);
    downloadFile(`recall-${messageId}.json`, json, 'application/json');
    setOpen(false);
  };

  const exportPdf = () => {
    const html = HTML_FRAME(headerLine, mdToHtml(content));
    const w = window.open('', '_blank', 'width=900,height=900');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export this message"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px',
          background: 'var(--surface-3)', border: '1px solid var(--border)',
          borderRadius: 20, color: 'var(--text-3)', fontSize: 10.5, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit'
        }}
      >
        <MoreHorizontal size={11} /> Export
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} role="menu" aria-label="Message export options" style={{
          position: 'fixed', top: pos.top, left: pos.left, minWidth: 200,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
          padding: 5, zIndex: 99999
        }}>
          {[
            { icon: copied ? Check : Copy, label: copied ? 'Copied!' : 'Copy text', onClick: copy, tint: copied ? '#10b981' : undefined },
            { icon: FileText, label: 'Save as Markdown', onClick: exportMd },
            { icon: FileCode, label: 'Save as HTML', onClick: exportHtml },
            { icon: Printer, label: 'Print / Save as PDF', onClick: exportPdf },
            { icon: Braces, label: 'Save as JSON', onClick: exportJson },
          ].map(item => (
            <button key={item.label} onClick={item.onClick} role="menuitem"
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                padding: '8px 10px', background: 'transparent', border: 'none',
                borderRadius: 7, color: item.tint || 'var(--text-2)', fontSize: 12,
                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
              <item.icon size={13} /> {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

export default MessageToolbar;
