# Domain modules

FlipPeak is a modular monolith. Each folder here owns one domain responsibility
and nothing else.

| Module | Owns | Arrives in |
| --- | --- | --- |
| `ranking` | Dense-ranked competitive position from Time Rate alone | Phase 1 (pure), Phase 7 (SQL) |
| `economics` | Exact money, Time Rate rules, settlement, ledger | Phase 1 (partial), Phase 6 |
| `auth` | Sessions, roles, ownership resolution | Phase 2 |
| `campaigns` | Campaign identity and campaign run lifecycle | Phase 3 |
| `payments` | PayPal orders, webhooks, idempotent crediting | Phase 4 |
| `analytics` | Impressions, outbound clicks, rank history | Phase 9 |
| `notifications` | Outbox, expiry warnings | Phase 9 |
| `moderation` | Preflight screening boundary, admin actions | Phase 10 |

## Rules

1. Files in `src/modules/**` do not import `react`, `next` or `react-dom`. This
   is enforced by one ESLint rule so domain logic stays testable without
   rendering (master prompt section 35).
2. `ranking` may never read budget, spend, clicks, impressions, account age or
   campaign age. It receives `Rankable`, which carries only an id and a Time
   Rate, so those fields are not merely unused but unavailable.
3. Business constants live in `src/config/domain-config.ts`, never inline.
4. Money is `Cents`. A plain `number` will not type-check where money is
   expected.
