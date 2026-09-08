/**
 * Makes the fixture state unmistakable.
 *
 * Phase 1 renders a design shell. A visitor must never mistake fixture data for
 * a live market (master prompt section 55).
 */
export function DevelopmentNotice() {
  return (
    <div className="border-b border-line bg-surface">
      <p className="mx-auto max-w-5xl px-5 py-2.5 text-[0.75rem] text-muted sm:px-8">
        <span className="font-medium text-warning">Development preview.</span> The market below is
        fixture data used to build the interface. No campaigns are running and no money is moving.
      </p>
    </div>
  );
}
