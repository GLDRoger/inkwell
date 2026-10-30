import { useEffect, useRef } from "react";

/** "Delete this page?" in the app's own design, instead of the browser's confirm(). */
export function DeleteDialog({
  open,
  title,
  inside,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  /** How many pages are inside it (they go too). */
  inside: number;
  onCancel(): void;
  onConfirm(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      cancelRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      onClose={onCancel}
      onClick={(e) => e.target === ref.current && onCancel()}
    >
      <div className="confirm-box">
        <h2 id="confirm-title" className="confirm-title">Delete “{title}”?</h2>
        <p id="confirm-body" className="confirm-body">
          {inside > 0
            ? `The ${inside === 1 ? "page" : `${inside} pages`} inside it will be deleted too. You can undo this for a few seconds.`
            : "You can undo this for a few seconds."}
        </p>
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="pill-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="pill-button pill-primary" onClick={onConfirm}>
            Delete page
          </button>
        </div>
      </div>
    </dialog>
  );
}
