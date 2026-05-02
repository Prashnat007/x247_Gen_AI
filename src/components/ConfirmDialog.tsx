import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<Props> = ({
  open, title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  destructive = false,
  onConfirm, onCancel,
}) => {
  // Refs let us trap Tab focus inside the dialog, restore the previously
  // focused element on close, and scope the Enter shortcut so it only
  // fires when focus is actually inside this dialog (preventing surprise
  // destructive actions from background controls).
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = (document.activeElement as HTMLElement) || null;
    // Move focus into the dialog on open so keyboard users land here.
    confirmBtnRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      // Only handle Enter / Tab when focus is somewhere inside the dialog,
      // so a focused field elsewhere on the page can't trigger confirm.
      const dialog = dialogRef.current;
      const focusInside = dialog && document.activeElement && dialog.contains(document.activeElement);
      if (!focusInside) return;

      if (e.key === 'Enter') {
        // Skip when Enter is the natural action of a non-button control
        // (e.g. textarea), but our dialog only has buttons so this is safe.
        e.preventDefault();
        onConfirm();
        return;
      }
      if (e.key === 'Tab') {
        // Two-stop focus trap: cycle between cancel and confirm buttons.
        const cancel = cancelBtnRef.current;
        const confirm = confirmBtnRef.current;
        if (!cancel || !confirm) return;
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === cancel) { e.preventDefault(); confirm.focus(); }
        } else {
          if (active === confirm) { e.preventDefault(); cancel.focus(); }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Restore focus to whatever was focused before the dialog opened.
      const prev = previouslyFocusedRef.current;
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus(); } catch { /* ignore */ }
      }
    };
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const accentBg = destructive
    ? 'linear-gradient(135deg, rgba(239,68,68,0.16), rgba(239,68,68,0.06))'
    : 'linear-gradient(135deg, rgba(99,102,241,0.16), rgba(99,102,241,0.06))';
  const accentColor = destructive ? '#f87171' : '#a78bfa';
  const confirmBg = destructive
    ? 'linear-gradient(135deg, #ef4444, #dc2626)'
    : 'linear-gradient(135deg, #6366f1, #4f46e5)';

  return (
    <AnimatePresence>
      <div style={{ position: 'fixed', inset: 0, zIndex: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onCancel}
          style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,15,0.78)', backdropFilter: 'blur(8px)' }}
        />
        <motion.div
          ref={dialogRef}
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.16 }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          style={{
            position: 'relative', width: '100%', maxWidth: 420,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, overflow: 'hidden',
            boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{
            background: accentBg,
            borderBottom: '1px solid var(--border)',
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `${accentColor}22`, border: `1px solid ${accentColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={15} color={accentColor} />
            </div>
            <div id="confirm-dialog-title" style={{ flex: 1, color: 'var(--text-1)', fontSize: 13.5, fontWeight: 700 }}>
              {title}
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}
            >
              <X size={12} />
            </button>
          </div>

          <div id="confirm-dialog-message" style={{ padding: '14px 16px', color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.55 }}>
            {message}
          </div>

          <div style={{ padding: '10px 16px 14px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              ref={cancelBtnRef}
              type="button"
              onClick={onCancel}
              data-testid="button-confirm-cancel"
              style={{
                padding: '8px 14px', borderRadius: 8,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--text-2)', fontWeight: 600, fontSize: 12, fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              onClick={onConfirm}
              data-testid="button-confirm-ok"
              style={{
                padding: '8px 14px', borderRadius: 8,
                background: confirmBg, color: '#fff', border: 'none',
                fontWeight: 700, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ConfirmDialog;
