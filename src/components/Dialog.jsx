import { useId, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Modal dialog on the native <dialog> element: it traps focus, closes on Escape
// through onClose, and returns focus to the control that opened it.
export default function Dialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      // Wait until React has removed the dialog; nested dialogs then hand focus
      // back to the outermost opener that still exists.
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog glass-panel${wide ? ' dialog-wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <h3 id={titleId}>{title}</h3>
        <button
          type="button"
          className="btn-secondary dialog-close"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
