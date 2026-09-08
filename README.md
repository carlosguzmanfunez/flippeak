# FlipPeak

A live marketplace for advertising attention.

Advertisers set a **Time Rate** in dollars per hour. The rate sets the
competitive position. The budget only decides how long that position can be
held.

```
POSITION = f(Time Rate)
DURATION = f(Budget, Time Rate)
```

A campaign funded with $20 at $25/hour outranks a campaign funded with $5,000 at
$20/hour. It just does not last as long.

---

## Status: Phase 1 — foundation

This repository currently contains the project foundation and a development
shell for the Live Market. There is **no database schema, no authentication, no
payment integration and no economic engine yet.** The market you see when you run
the app is fixture data, labelled as such in the interface.

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Repository, tooling, design system, Live Market shell | this repository |
| 2 | Authentication, first migration | not started |
| 3 | Campaigns and campaign runs | not started |
| 4 | PayPal Sandbox payments | not started |
| 5–6 | Budget settlement and the economic engine | not started |
| 7–8 | Production ranking and Live Market | not started |
| 9–10 | Analytics, Legends, moderation, hardening | not started |

---

## Getting started

Requires Node 20.11 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

No environment variables are required to run Phase 1. `DATABASE_URL` is optional
until Phase 2.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest, domain rules only |
| `npm run verify` | lint, typecheck, test and build in sequence |
| `npm run db:generate` | Drizzle migration generation (no schema yet) |

---

## Structure

```
src/
  app/                    Next.js routes. Thin: authenticate, validate,
                          call a domain service, map the result.
  config/
    domain-config.ts      Every business constant. Single source of truth.
    env.ts                Parsed environment.
  db/
    client.ts             Lazy, transaction-capable Neon client.
    schema.ts             Empty until Phase 2.
  lib/                    Small framework-free helpers.
  modules/                Domain modules. See src/modules/README.md.
    ranking/              Dense ranking. Reads Time Rate and nothing else.
    economics/            Exact money and Time Rate rules.
    campaigns/ payments/ auth/ analytics/ notifications/ moderation/
  ui/
    tokens.css            Design tokens. No component defines a raw colour.
    shell/ market/        Presentation.
    market/__dev__/       Development fixtures. Nothing else imports these.
docs/
  architecture-decisions.md
  preview/                Static design reference. Not part of the app.
```

---

## Domain invariants

These are enforced by structure, not by convention. The enforcement point is
named for each one.

| # | Invariant | Enforced by |
| --- | --- | --- |
| 1 | Rank comes only from current Time Rate | `Rankable` carries no other field |
| 2 | Budget affects duration, not rank | ranking never receives budget |
| 3 | Equal rates share a position | `buildTiers` groups by rate |
| 4 | Live ranking is dense | `buildTiers`, and `DENSE_RANK()` in Phase 7 |
| 5 | An active run cannot lower its rate | Boost transaction (ADR-003) |
| 6 | A new run may choose any valid rate | run creation, Phase 3 |
| 7 | An exhausted run does not stay active | eligibility derived at read time |
| 8 | Run Again never revives an exhausted run | new `campaign_run` row, Phase 3 |
| 9 | Credits are idempotent | unique provider ids, Phase 4 |
| 10 | A browser return cannot credit money | webhook is the only credit path |
| 11 | Ownership is resolved server-side | session, never a request parameter |
| 12 | Subtype creates no separate market | subtype is not a ranking input |
| 13 | Rotation never changes rank | rotation is computed in the view layer |
| 14 | Money is exact integers | branded `Cents` type |
| 15 | Server time is authoritative | `now()` inside the settlement transaction |

---

## Conventions

- **Money** is always integer cents, typed as `Cents`, named `...Cents`. A plain
  number will not compile where money is expected.
- **Time Rate** is `timeRateCentsPerHour`. Never `rate`, `burn` or `speed`.
- **Vocabulary** is Time Rate, Spend, Amount Spent, Campaign Spend. The term
  "burn rate" does not appear in this product.
- **Timestamps** are UTC. Economic state is calculated from server time, never
  from a browser clock.
- **Domain modules** do not import React or Next. One ESLint rule enforces this.

---

## Deployment

The project targets Vercel with Neon PostgreSQL.

Development and preview environments must use test or staging Neon branches and
PayPal Sandbox. A preview deployment must never point at the production
database.
