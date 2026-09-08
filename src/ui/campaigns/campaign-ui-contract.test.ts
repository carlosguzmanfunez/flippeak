import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Structural assertions about the shipped UI files.
 *
 * The project has no DOM test environment, so these cannot render components.
 * They instead assert invariants that must hold in the source itself: which
 * fields the form submits, and that both routes run the server-side access
 * decision before rendering. They check meaning rather than formatting, so
 * normal edits do not break them.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const form = read('./campaign-form.tsx');
const newCampaignPage = read('../../app/campaigns/new/page.tsx');
const myCampaignsPage = read('../../app/my-campaigns/page.tsx');

describe('the form submits only the approved fields', () => {
  it('sets exactly five FormData entries', () => {
    const keys = [...form.matchAll(/formData\.set\('([a-zA-Z]+)'/g)].map((match) => match[1]);
    expect(keys.sort()).toEqual(
      ['category', 'destinationUrl', 'subtype', 'summary', 'title'].sort(),
    );
  });

  it('never sets an owner, user id or role entry', () => {
    for (const forbidden of ['ownerUserId', 'userId', 'role', 'advertiserId', 'id']) {
      expect(form).not.toContain(`formData.set('${forbidden}'`);
    }
  });

  it('renders no Time Rate, budget, payment or run control', () => {
    expect(form).not.toMatch(/timeRate|time_rate|budget|paypal|payment|campaignRun|campaign_run/i);
  });

  it('uses a single-line input for the summary, since line breaks are rejected', () => {
    expect(form).not.toContain('<textarea');
  });

  it('disables the submit control while the action is pending', () => {
    expect(form).toContain('pending={pending}');
    expect(form).toContain('if (pending) return;');
  });
});

describe('both campaign routes are protected on the server', () => {
  it.each([
    { route: '/campaigns/new', source: newCampaignPage },
    { route: '/my-campaigns', source: myCampaignsPage },
  ])('$route resolves the principal and redirects to /login', ({ source }) => {
    expect(source).toContain('getAuthenticatedPrincipal()');
    expect(source).toContain('decideUserAccess(');
    expect(source).toContain("redirect('/login')");
  });

  it.each([
    { route: '/campaigns/new', source: newCampaignPage },
    { route: '/my-campaigns', source: myCampaignsPage },
  ])('$route decides access before rendering anything', ({ source }) => {
    const decision = source.indexOf('decideUserAccess(');
    const markup = source.indexOf('<SiteHeader');
    expect(decision).toBeGreaterThan(-1);
    expect(markup).toBeGreaterThan(decision);
  });
});

describe('my campaigns reads through the owner-scoped query', () => {
  it('calls listOwnCampaigns with the principal from the access decision', () => {
    expect(myCampaignsPage).toContain('listOwnCampaigns(decision.principal)');
  });

  it('shows no run, rank, Time Rate or budget data', () => {
    expect(myCampaignsPage).not.toMatch(/timeRate|budget|rank|status|campaignRun/i);
  });

  it('offers an empty state that leads to campaign creation', () => {
    expect(myCampaignsPage).toContain('campaigns.length === 0');
    expect(myCampaignsPage).toContain("href=\"/campaigns/new\"");
  });
});

describe('protected campaign pages resolve the session once per request', () => {
  // Counting calls inside page.tsx alone would be misleading: SiteHeader is part
  // of the same render and resolves for itself unless a principal is handed to
  // it. These assert the composition; the rule the header applies is covered by
  // site-header-model.test.ts with a spy resolver.
  it.each([
    { route: '/campaigns/new', source: newCampaignPage },
    { route: '/my-campaigns', source: myCampaignsPage },
  ])('$route hands its resolved principal to SiteHeader', ({ source }) => {
    expect(source).toContain('<SiteHeader principal={decision.principal} />');
    expect(source).not.toContain('<SiteHeader />');
  });

  it.each([
    { route: '/campaigns/new', source: newCampaignPage },
    { route: '/my-campaigns', source: myCampaignsPage },
  ])('$route resolves the session exactly once itself', ({ source }) => {
    expect([...source.matchAll(/getAuthenticatedPrincipal\(\)/g)]).toHaveLength(1);
  });

  it('SiteHeader only reaches the session store through the guarded rule', () => {
    const header = read('../shell/site-header.tsx');
    expect(header).toContain('resolveHeaderViewer(supplied, getAuthenticatedPrincipal)');
    // The resolver is passed as a reference, never invoked unconditionally.
    expect(header).not.toMatch(/await getAuthenticatedPrincipal\(\)/);
  });

  it('pages that do not supply a principal keep the original behaviour', () => {
    for (const page of ['../../app/page.tsx', '../../app/account/page.tsx', '../../app/login/page.tsx']) {
      expect(read(page)).toContain('<SiteHeader />');
    }
  });
});

describe('approved auth UI is untouched by this feature', () => {
  it('the campaign form uses the neutral form controls, not the auth ones', () => {
    expect(form).toContain("from '@/ui/forms/form-parts'");
    expect(form).not.toContain('auth-form-parts');
  });
});

describe('CampaignRun surfaces', () => {
  const runForm = read('./run-form.tsx');
  const control = read('./time-rate-control.tsx');
  const runPage = read('../../app/campaigns/[id]/run/page.tsx');
  const runsPage = read('../../app/campaigns/[id]/runs/page.tsx');

  it('the run form submits only a campaign id and a Time Rate', () => {
    const keys = [...runForm.matchAll(/formData\.set\('([a-zA-Z]+)'/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(['campaignId', 'timeRateCentsPerHour'].sort());
  });

  it('the run form sends no owner, status, snapshot or budget field', () => {
    for (const forbidden of [
      'ownerUserId',
      'userId',
      'role',
      'status',
      'title',
      'summary',
      'destinationUrl',
      'budget',
    ]) {
      expect(runForm).not.toContain(`formData.set('${forbidden}'`);
    }
  });

  it('never renders a single slider spanning the whole range', () => {
    // The standard slider is bounded by the standard ceiling, not by the maximum.
    expect(control).toContain('max={STANDARD_MAX}');
    expect(control).not.toContain('max={HIGH_MAX}');
    expect(control).toContain('type="range"');
    // High Rate is a text field, not a second slider.
    expect(control.match(/type="range"/g)).toHaveLength(1);
  });

  it('disables the submit control while the action is pending', () => {
    expect(runForm).toContain('if (pending || !submittable) return;');
    expect(runForm).toContain('pending={pending || !submittable}');
  });

  it.each([
    { route: '/campaigns/[id]/run', source: runPage },
    { route: '/campaigns/[id]/runs', source: runsPage },
  ])('$route is protected on the server and scoped to the owner', ({ source }) => {
    expect(source).toContain('getAuthenticatedPrincipal()');
    expect(source).toContain('decideUserAccess(');
    expect(source).toContain("redirect('/login')");
    expect(source).toContain('loadOwnedCampaign(decision.principal');
  });

  it.each([
    { route: '/campaigns/[id]/run', source: runPage },
    { route: '/campaigns/[id]/runs', source: runsPage },
  ])('$route resolves the session once and hands it to SiteHeader', ({ source }) => {
    expect([...source.matchAll(/getAuthenticatedPrincipal\(\)/g)]).toHaveLength(1);
    expect(source).toContain('<SiteHeader principal={decision.principal} />');
  });

  it.each([
    { route: '/campaigns/[id]/run', source: runPage },
    { route: '/campaigns/[id]/runs', source: runsPage },
  ])('$route answers an unowned campaign as not found', ({ source }) => {
    expect(source).toContain('notFound()');
    expect(source).toContain('campaign === null');
  });

  it('the runs list shows no balance, duration or budget it cannot support', () => {
    // Comments are stripped: the assertion is about what is rendered, not about
    // the prose that explains why it is not.
    const code = runsPage.replace(/\/\*\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/budget|balance|remaining|credited|consumed|formatDuration/i);
  });

  it('no Run Again UI is present, because EXHAUSTED cannot yet occur legitimately', () => {
    for (const source of [runForm, runsPage, runPage]) {
      expect(source).not.toContain('createRunAgainAction');
      expect(source).not.toMatch(/run again/i);
    }
  });
});
