import type { Rankable } from '@/modules/ranking/dense-rank';

/**
 * What the Live Market needs to render one campaign run.
 *
 * `Rankable` contributes the only field ranking may read. Everything else here
 * is presentation and is never seen by the ranking module.
 */
export interface MarketEntry extends Rankable {
  readonly title: string;
  readonly summary: string;
  readonly categoryLabel: string;
  readonly subtype: string | null;
  readonly remainingRuntimeMs: number;
  /** Initial runtime at the current rate (credited capacity / rate), derived server-side. */
  readonly initialRuntimeMs: number;
  /** Authorized snapshot destination (validated https on the backend). */
  readonly destinationUrl: string;
}
