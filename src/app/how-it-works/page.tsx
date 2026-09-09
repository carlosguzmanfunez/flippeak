import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteHeader } from '@/ui/shell/site-header';
import { getAuthenticatedPrincipal } from '@/lib/auth-guards';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'How It Works — FlipPeak',
  alternates: { canonical: '/how-it-works' },
};

const STEPS = [
  {
    title: 'Set Your Time Rate',
    copy: 'Your rate determines your position. Choose any whole-dollar rate between $1 and $1,000 per hour — the higher your rate, the higher you compete.',
    icon: 'M3 16h4l4-9 3 5 3-3h4v6H3z',
  },
  {
    title: 'Fund Your Campaign',
    copy: 'Add budget to keep your ad live. Budget never buys position: it determines how long you can hold your Time Rate.',
    icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm1 5h-2v6l5 3 1-2-4-2z',
  },
  {
    title: 'Compete for Visibility',
    copy: 'Equal Time Rates share the same position, with a rotating spotlight for exposure. When your budget runs out, the market reflects it immediately—no surprises.',
    icon: 'M3 17h3l3-8 3 4 3-9 2 5h4v2h-5l-1-1.5L12 16l-2.4-5.2L7 19H3z',
  },
];

export default async function HowItWorksPage() {
  const principal = await getAuthenticatedPrincipal();
  const cta = principal ? '/campaigns/new' : '/register';

  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-[760px] px-4 py-14 sm:px-8">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-primary-blue">
            How It Works
          </p>
          <h1 className="mt-3 text-[2rem] font-extrabold tracking-tight text-navy sm:text-[2.5rem]">
            A transparent marketplace. <span className="text-electric">Nothing hidden.</span>
          </h1>
          <p className="mt-4 max-w-[58ch] text-[1.0625rem] leading-relaxed text-muted">
            Your Time Rate determines your position. Budget determines how long you can hold it.
            No one secretly buys priority — everything you see is backed by real system state.
          </p>

          <ol className="mt-10 space-y-5">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-5 rounded-2xl border border-line bg-surface p-6 shadow-card">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-soft-blue text-primary-blue">
                  <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
                    <path d={step.icon} />
                  </svg>
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                    Step {index + 1}
                  </p>
                  <h2 className="mt-0.5 text-[1.25rem] font-bold text-navy">{step.title}</h2>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{step.copy}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10 rounded-2xl border border-line bg-softtint p-6 text-center">
            <p className="text-[15px] font-semibold text-navy">
              Ready to put your brand on top?
            </p>
            <Link
              href={cta}
              className="mt-4 inline-flex items-center justify-center rounded-[10px] bg-electric px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-primary-blue"
            >
              Start Advertising
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
