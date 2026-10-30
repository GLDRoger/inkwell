/** Inkwell's mark: an ink drop in a dot. Inherits the text colour; the drop takes the paper colour. */
export function Mark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="12" fill="currentColor" />
      <path d="M12 5.6c-.9 1.3-4.1 5.3-4.1 8.1a4.1 4.1 0 0 0 8.2 0c0-2.8-3.2-6.8-4.1-8.1Z" fill="var(--paper)" />
    </svg>
  );
}
