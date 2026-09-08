# Architecture decisions

Short records of decisions that were genuinely decided, not a log of everything
that was typed. Each entry states the decision and what it rules out.

---

## ADR-001 — Ranking and economics are separate subsystems

**Decision.** Ranking is a pure function over a snapshot. Economics is a
transactional, stateful, database-authoritative subsystem. They are coupled by
exactly two things: `timeRateCentsPerHour` and an eligibility boolean.

**Why.** Every ranking invariant in the specification is a statement about what
ranking must *not* see. Making those fields unavailable rather than merely
unused turns the invariants into type errors instead of review comments.

**Rules out.** Any tie breaker involving budget, spend, clicks, impressions,
account age or campaign age, because the ranking module never receives them.

---

## ADR-002 — No initial migration in Phase 1

**Decision.** Phase 1 ships the database dependency, a lazy client and a
Drizzle config, but no schema and no migration. The first migration is generated
in Phase 2 together with authentication.

**Why.** The authentication library determines the user and session tables. A
migration written now would be replaced immediately, which contradicts the
requirement that the initial migration describe FlipPeak directly rather than a
fictional history.

---

## ADR-003 — The active-rate invariant is enforced in a transaction, not a constraint

**Decision.** "An active run may never decrease its Time Rate" is enforced
inside the Boost service: lock the run, settle to database-authoritative `now()`,
reject if exhausted, reject unless the proposed rate is strictly greater, then
apply atomically.

**Why.** A `CHECK` constraint cannot compare the old row against the new one, so
it cannot express this rule. A trigger could, but adds a second enforcement point
for no current benefit. The transaction already has to exist for settlement.

**Rules out.** Relying on the UI, on optimistic checks, or on a constraint that
looks like enforcement but is not.

---

## ADR-004 — One transaction-capable database driver

**Decision.** The application uses `drizzle-orm/neon-serverless` over a
connection pool everywhere.

**Why.** Neon's HTTP driver is faster for single reads but cannot run
multi-statement transactions. Payment crediting and budget settlement both
require them. One driver with one set of semantics is preferable to two code
paths that behave differently under concurrency.

---

## ADR-005 — Dense ranking has a reference implementation and a SQL implementation

**Decision.** `src/modules/ranking/dense-rank.ts` is the reference. Phase 7 adds
a PostgreSQL `DENSE_RANK()` query for the production Live Market, tested against
the reference on identical fixtures.

**Why.** Ranking a live market in application memory does not scale, and
recomputing it in SQL is a one-line window function. The risk is divergence, so
the two are pinned together by tests rather than by hope.

---

## ADR-006 — Minimum funding is deliberately undefined

**Decision.** No minimum funding constant exists. `domain-config.ts` records its
absence explicitly.

**Why.** A minimum runtime rule would imply a large minimum payment at high Time
Rates ($500 for thirty minutes at $1,000/hour) and that economic restriction has
not been approved. High Rate UX must instead make very short runtimes obvious
before confirmation.

**Blocks.** Checkout and payment validation cannot ship until this is decided.

---

## ADR-007 — The Live Market page is request-rendered in Phase 1

**Decision.** The Phase 1 shell uses `dynamic = 'force-dynamic'` so it can pass
an authoritative timestamp to the spotlight rotation.

**Why.** Rotation must be globally synchronised rather than restarting on every
page load. Phase 8 moves market state behind a small endpoint that returns
server time with the tiers, which lets the page be statically rendered again.

---

## ADR-008 — One economic engine, defined once

**Decision.** Consumption is not implemented in Phase 1. When the economic phase
begins, the consumption formula is written as a canonical specification with a
small TypeScript implementation and a small SQL implementation, tested against
identical fixtures.

**Why.** The formula has to exist in SQL for ranking eligibility and in
TypeScript for projections. Two independent implementations that drift is the
worst outcome available, so the duplication is kept minimal, explicit and pinned
by tests. Phase 1 does not pre-empt that specification with helpers that would
quietly become a second engine.

---

## ADR-009 — Tier ordering uses a stable hash with no competitive meaning

**Decision.** Campaigns inside a tier are ordered by FNV-1a hash of the run id,
falling back to id comparison on collision.

**Why.** Rendering and rotation need a deterministic order. Ordering by creation
time or activation time would hand the first spotlight to whoever arrived first,
which is a hidden tie breaker in everything but name.

**Fairness.** Equal spotlight duration holds while tier membership is stable. If
a run joins or leaves, the cycle composition changes. This has no ranking effect.

---

## ADR-010 — Type safety over lint rules for money

**Decision.** Money exactness is protected by the branded `Cents` type,
`*Cents` naming, centralised utilities and tests. There is exactly one boundary
lint rule, keeping framework imports out of domain modules.

**Why.** A lint rule banning `Number()` or `parseFloat()` across the codebase
produces false positives in unrelated code and gets disabled. A type that makes
an unconverted number fail to compile does not.

## ADR-011 — Consumption is measured in cent-milliseconds, never in rounded cents

**Decision.** A funded run's consumption is tracked as an integer count of
cent-milliseconds, where `1 cent = 3,600,000 cent-ms` because a Time Rate is
expressed per hour and an hour is 3,600,000 ms. Three fields carry the state:

- `credited_cents` — the sum of verified credits, in the same unit PayPal uses
- `consumed_cent_ms` — consumption already settled, monotonically increasing
- `rate_anchor_at` — the instant from which the current Time Rate applies

Consumption at any moment is derived, not stored:

```
elapsed_ms  = floor(ms between rate_anchor_at and now())
projected   = consumed_cent_ms + time_rate_cents_per_hour * elapsed_ms
remaining   = credited_cents * 3_600_000 - projected
```

Settling advances `consumed_cent_ms` by `rate * elapsed_ms` and advances
`rate_anchor_at` by exactly that whole number of milliseconds. The sub-
millisecond remainder stays in the gap between the new anchor and now, so it is
counted next time rather than discarded.

**Why.** At $1/hour a second costs 100/3600 cents. Any model that rounds to
whole cents therefore loses a fraction at every settlement, and the loss
accumulates across boosts and re-credits. Multiplying by the number of
milliseconds in an hour turns the division into a multiplication: `rate × ms` is
an exact integer product with no rounding anywhere, and every millisecond is
charged exactly once at exactly the rate in force.

**Rejected alternatives.** A stored `remaining_balance_cents` decremented on a
timer is stale between ticks and silently overspends if the ticker stops. The
withdrawn `consumed_cents + settled_at` model rounds at each settlement, which
is the accumulation problem above. Rational numerator/denominator pairs are
exact but need two columns and cross-multiplied comparisons for no gain over a
fixed denominator. PostgreSQL `NUMERIC` is exact but is not integer money and
forces decimal handling through the whole application.

**Consequences.** `bigint` columns are required: `credited_cents × 3,600,000`
exceeds a 32-bit integer. JavaScript stays exact up to about $25 million of
funding per run, far beyond any plausible value, but the columns must be read as
numbers deliberately rather than as strings. Rate changes closer together than
one millisecond are not representable, so a settlement that advances the anchor
by zero must not also change the rate.

## ADR-012 — Economic eligibility is derived; EXHAUSTED is a materialisation

**Decision.** A run stops competing at the instant its remaining balance reaches
zero, computed from authoritative PostgreSQL time. The `EXHAUSTED` status is a
record of that fact written afterwards, not the fact itself. Ranking and
eligibility queries filter on the derived condition, not only on the stored
status.

**Why.** Any process that writes the status — a request, a job, a cron tick —
runs after the economic event. If ranking trusted the column alone, a run that
ran out seconds ago would keep competing until the writer caught up, and the
gap would be visible to competitors as an unfair advantage. Deriving the
condition removes the race from the competitive path and leaves the writer with
the easier job of recording history.

**Consequences.** Consumption is capped at the credited amount when derived, so
remaining is never negative. The exhaustion instant is computable in closed form
from the anchor, the rate and the remaining balance, which is what lets a job
schedule the materialisation instead of polling. Cron may reconcile, materialise
and notify; it is never the source of economic truth.

## ADR-013 — One engine, and the two roundings point in opposite directions

**Decision.** `src/modules/economics/run-accounting.ts` is the single consumption
engine. Any parallel implementation is retired rather than merged. Conformance
is decided by `conformance-suite.ts`, which checks an implementation against an
independent BigInt restatement of ADR-011 rather than against another engine.

Two roundings exist and they are not the same rounding:

| Quantity | Rounding | Why |
|---|---|---|
| elapsed milliseconds | **floor** | A millisecond half-elapsed has not been consumed |
| `deficit / rate` for the exhaustion instant | **ceil** | The balance reaches zero *inside* that millisecond, not at the end of the previous one |

**Why this needed recording.** An earlier review corrected the exhaustion instant
from floor to ceil. Read without the qualifier, that reads as "this model rounds
up", and the correction was generalised to elapsed time. A ceiling on elapsed
charges for time that has not passed and pushes the anchor past the instant
settled to, which makes the next settlement observe negative elapsed time — a
clock inversion the system inflicts on itself.

**Why two engines could not be reconciled.** Agreement between two
implementations proves consistency, not correctness. A ceiling engine and its
own SQL mirror agree perfectly with each other and are both wrong. The
conformance suite exists because only an independent statement of the
specification can tell those apart, and it demonstrably discriminates: with
whole-millisecond inputs a ceiling engine passes every arithmetic check and
fails only at the boundary where a fractional duration is reduced.

**Consequences.** The engine accepts whole milliseconds and refuses anything
else, so the reduction is the caller's responsibility and must be identical in
the SQL that computes eligibility. Both sides implement the same floor, and both
are checked by the same suite.
## ADR-014 — PayPal funding: two-level idempotency and capture sovereignty

**Decision.** Verified webhook events are the only financial authority. A Capture ID
accredits exactly once no matter how many distinct events refer to it; a Webhook Event ID
is processed at most once; the browser return never credits. The order's local checkout
state can never dismiss a genuine COMPLETED capture.

Two constraints are the guarantee:

| Level | UNIQUE | What it prevents |
|---|---|---|
| Event | `(provider, provider_event_id)` on `payment_event` | replay of the same delivery |
| Capture | `(provider, provider_capture_id)` on `payment_order` | two different events crediting the same capture |

**Capture sovereignty.** A local order marked ABANDONED is a statement of intent, not of
money; `ABANDONED → CAPTURED` is a valid transition on a verified capture. An orphan
capture (no local order) is persisted for reconciliation, never discarded.

**Exactness ceiling (representation, not policy).** With `MAX_SAFE = 2^53 - 1` and the
modelled unit `1 cent = 3,600,000 cent-ms`:

`MAX_CREDIT_CENTS = floor(MAX_SAFE / 3_600_000) = 2_501_999_792` (`,019,997.92`)

so capacity `<= 9.007.199.251.200.000 <= MAX_SAFE` and `rate x ceil(deficit/rate) <=
deficit + rate <= 9.007.199.251.300.000 <= MAX_SAFE` for every `rate <= 100_000`: all
engine arithmetic stays exact. This is a numeric representation limit only; the commercial
budget minimum/maximum stays deliberately undecided.