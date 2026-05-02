import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Save, Loader2, Tag as TagIcon, Plus } from 'lucide-react';
import type { Memory } from '../lib/types';
import { showToast } from '../App';

interface Props {
  memory: Memory | null;
  onClose: () => void;
  onSaved: (updated: Memory) => void;
}

const MemoryEditModal: React.FC<Props> = ({ memory, onClose, onSaved }) => {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (memory) {
      setTitle(memory.title || '');
      setSummary(memory.summary || '');
      setSourceUrl(memory.source_url || '');
      setTags([...(memory.tags || [])]);
      setTagInput('');
      // Focus title for quick edits.
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [memory]);

  // ESC closes
  useEffect(() => {
    if (!memory) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory, title, summary, sourceUrl, tags]);

  if (!memory) return null;

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.some(x => x.toLowerCase() === t.toLowerCase())) {
      setTagInput('');
      return;
    }
    if (tags.length >= 24) {
      showToast('Max 24 tags', 'error');
      return;
    }
    setTags([...tags, t]);
    setTagInput('');
  };
  const removeTag = (t: string) => setTags(tags.filter(x => x !== t));

  const handleSave = async () => {
    const t = title.trim();
    if (!t) {
      showToast('Title cannot be empty', 'error');
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    const body: Record<string, unknown> = {
      title: t,
      summary: summary.trim(),
      source_url: sourceUrl.trim(),
      tags,
    };
    try {
      const res = await fetch(`/memories/${memory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
      const updated: Memory = {
        ...memory,
        title: t,
        summary: summary.trim(),
        source_url: sourceUrl.trim() || undefined,
        tags,
      };
      onSaved(updated);
      showToast('Memory updated');
    } catch (err) {
      console.error(err);
      showToast("Couldn't save changes", 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,15,0.78)', backdropFilter: 'blur(8px)' }}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 18 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="memory-edit-title"
          style={{
            position: 'relative', width: '100%', maxWidth: 580,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 18, overflow: 'hidden',
            boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
            display: 'flex', flexDirection: 'column',
            maxHeight: 'calc(100vh - 32px)',
          }}
        >
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.14), rgba(139,92,246,0.06))',
            borderBottom: '1px solid var(--border)',
            padding: '14px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ color: '#a78bfa', fontSize: 9, fontWeight: 800, letterSpacing: '1.5px', marginBottom: 2 }}>EDIT MEMORY</div>
              <div id="memory-edit-title" style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {memory.title}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close edit dialog"
              data-testid="button-edit-close"
              style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: '16px 18px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Title" required>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={240}
                data-testid="input-edit-title"
                style={inputStyle}
              />
            </Field>

            <Field label="Summary / Notes">
              <textarea
                value={summary}
                onChange={e => setSummary(e.target.value)}
                maxLength={4000}
                rows={6}
                data-testid="input-edit-summary"
                style={{ ...inputStyle, resize: 'vertical', minHeight: 100, fontFamily: 'inherit', lineHeight: 1.5 }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'right', marginTop: 3 }}>
                {summary.length} / 4000
              </div>
            </Field>

            <Field label="Source URL">
              <input
                type="url"
                value={sourceUrl}
                onChange={e => setSourceUrl(e.target.value)}
                maxLength={2048}
                placeholder="https://…"
                data-testid="input-edit-url"
                style={inputStyle}
              />
            </Field>

            <Field label="Tags">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {tags.length === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>No tags yet</span>
                )}
                {tags.map(t => (
                  <span key={t} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px 3px 10px', borderRadius: 12,
                    background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.32)',
                    fontSize: 11, color: '#a78bfa', fontWeight: 600,
                  }}>
                    #{t}
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      aria-label={`Remove tag ${t}`}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#a78bfa', display: 'inline-flex', padding: 0 }}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <TagIcon size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
                  <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Add a tag and press Enter"
                    maxLength={48}
                    data-testid="input-edit-tag"
                    style={{ ...inputStyle, paddingLeft: 28 }}
                  />
                </div>
                <button
                  type="button"
                  onClick={addTag}
                  disabled={!tagInput.trim()}
                  data-testid="button-add-tag"
                  style={{
                    padding: '0 12px', borderRadius: 8,
                    background: tagInput.trim() ? 'var(--surface-2)' : 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-1)', fontWeight: 600, fontSize: 12, fontFamily: 'inherit',
                    cursor: tagInput.trim() ? 'pointer' : 'default',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Plus size={12} /> Add
                </button>
              </div>
            </Field>
          </div>

          {/* Footer */}
          <div style={{
            borderTop: '1px solid var(--border)',
            padding: '12px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
            background: 'var(--surface-2)',
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-3)', marginRight: 'auto', fontFamily: 'JetBrains Mono, monospace' }}>
              ⌘⏎ to save · esc to close
            </span>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              data-testid="button-edit-cancel"
              style={{
                padding: '8px 14px', borderRadius: 9,
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text-2)', fontWeight: 600, fontSize: 12, fontFamily: 'inherit',
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              data-testid="button-edit-save"
              style={{
                padding: '8px 16px', borderRadius: 9,
                background: saving || !title.trim() ? 'var(--surface-3)' : 'linear-gradient(135deg,#6366f1,#4f46e5)',
                color: '#fff', border: 'none', fontWeight: 700, fontSize: 12, fontFamily: 'inherit',
                cursor: saving || !title.trim() ? 'default' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text-1)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};

const Field: React.FC<{ label: string; required?: boolean; children: React.ReactNode }> = ({ label, required, children }) => (
  <div>
    <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-2)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 5 }}>
      {label}{required && <span style={{ color: '#f87171', marginLeft: 4 }}>*</span>}
    </label>
    {children}
  </div>
);

export default MemoryEditModal;
