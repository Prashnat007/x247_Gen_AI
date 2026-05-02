import React from 'react';

/**
 * Controlled `<textarea>` that grows with its content.
 *
 * The native textarea has a fixed height (set by `rows` or CSS), so once
 * the user types past that height the rest scrolls inside the box and
 * gets clipped. Across Recall X247 we use textareas for chat composers
 * (Recall, Agent), capture forms, profile bio, calendar event notes,
 * inline edit fields, etc. — every one of those wants the box to expand
 * as the user types so the whole draft stays visible.
 *
 * Controlled-only: pass `value` + `onChange`. (Uncontrolled `defaultValue`
 * is not supported because we can't observe edits without re-renders.)
 *
 * Behavior:
 *   - On every value change (and on mount) we reset `height` to 'auto'
 *     so the browser recomputes the natural content height, then snap
 *     `height` to `scrollHeight`. This is the standard auto-grow trick.
 *   - When `maxHeight` is provided (e.g. chat composers that should not
 *     consume the entire screen), we cap there and switch to inner
 *     scroll. Without `maxHeight` the textarea grows unbounded.
 *   - A ResizeObserver re-runs the calculation when the container width
 *     changes (mobile rotation, side drawer toggle, responsive layout
 *     breakpoint), since wrapping changes scrollHeight without a value
 *     change.
 *   - We default `resize: 'none'` because the JS sizing fights with the
 *     native drag handle. Callers can override via the `style` prop if
 *     they really want the user to be able to drag.
 *   - Forwards the ref so existing call sites that use `inputRef` (e.g.
 *     to focus on mount or after sending a message) keep working.
 */
interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string;
  maxHeight?: number;
}

const AutoGrowTextarea = React.forwardRef<HTMLTextAreaElement, Props>(
  ({ value, maxHeight, style, ...rest }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement, []);

    const recalc = React.useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      // Reset first so shrinking back down works as the user deletes.
      el.style.height = 'auto';
      const next = el.scrollHeight;
      if (maxHeight && next > maxHeight) {
        el.style.height = maxHeight + 'px';
        el.style.overflowY = 'auto';
      } else {
        el.style.height = next + 'px';
        el.style.overflowY = 'hidden';
      }
    }, [maxHeight]);

    // Re-run on value/maxHeight changes (the common case — user typed).
    React.useLayoutEffect(() => { recalc(); }, [value, recalc]);

    // Re-run when the container WIDTH changes. Without this, rotating a
    // phone or opening a side drawer can leave the height set to a stale
    // scrollHeight (text wraps differently at the new width but the
    // measured height was computed at the old width).
    //
    // Important: observe the PARENT, not the textarea itself. We mutate
    // the textarea's height inside recalc(), which would otherwise feed
    // back into the observer and trigger "ResizeObserver loop" warnings.
    // Width-only checking (lastWidth tracking) gives a second guard so
    // height-only changes never cause a re-entrant recalc even if the
    // parent's width is unchanged.
    React.useEffect(() => {
      const el = innerRef.current;
      const parent = el?.parentElement;
      if (!el || !parent || typeof ResizeObserver === 'undefined') return;
      let lastWidth = parent.clientWidth;
      const ro = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect.width ?? parent.clientWidth;
        if (w === lastWidth) return;
        lastWidth = w;
        recalc();
      });
      ro.observe(parent);
      return () => ro.disconnect();
    }, [recalc]);

    return (
      <textarea
        ref={innerRef}
        value={value}
        {...rest}
        style={{
          resize: 'none',
          overflow: 'hidden',
          ...style,
        }}
      />
    );
  },
);
AutoGrowTextarea.displayName = 'AutoGrowTextarea';
export default AutoGrowTextarea;
