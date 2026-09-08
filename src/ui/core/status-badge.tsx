/**
 * Lifecycle status visual (Phase 14).
 *
 * `DRAFT` = not competing; `ACTIVE` = competing while funded; `EXHAUSTED` =
 * finished history. The color ramps stay inside the tokens (muted/warning/
 * success) — none of them imply a product state the server did not say.
 */
export function StatusBadge({ status }: { readonly status: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: 'text-muted border-line' };
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[0.625rem] uppercase tracking-wider ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'text-muted border-line' },
  ACTIVE: { label: 'Active', className: 'text-success border-line-strong' },
  EXHAUSTED: { label: 'Exhausted', className: 'text-warning border-line-strong' },
};
