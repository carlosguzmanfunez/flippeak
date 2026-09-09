import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from './schema';

/**
 * Single transaction-capable database client.
 *
 * The Neon HTTP driver is faster for one-shot reads but cannot run
 * multi-statement transactions, which payment crediting and budget settlement
 * both require. One transactional driver is used everywhere rather than two
 * drivers with different semantics (ADR-004).
 *
 * The connection is created lazily: nothing should fail at import time when
 * DATABASE_URL is absent. During Next's build phase (NEXT_PHASE =
 * phase-production-build) a deferred proxy is returned instead of throwing:
 * the import-time auth wiring may evaluate db() while page data is collected,
 * but NO query runs during that phase — CI builds without a database, and the
 * contract is that the production build itself never needs one. At runtime
 * (requests) the same missing URL still fails loudly, exactly as before.
 */

const DATABASE_URL_ERROR =
  'DATABASE_URL is not set. Provide a pooled Neon connection string before using the database.';

let pool: Pool | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

function buildPhaseDeferred(): ReturnType<typeof drizzle<typeof schema>> {
  // Any real use during a query would propagate: construct/access/apply all
  // throw the runtime error. Only the import-time wiring is silenced.
  const fail = () => {
    throw new Error(DATABASE_URL_ERROR);
  };
  return new Proxy(
    {} as unknown as ReturnType<typeof drizzle<typeof schema>>,
    { get: fail, apply: fail, construct: fail },
  );
}

export function db(): ReturnType<typeof drizzle<typeof schema>> {
  if (database === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString.length === 0) {
      if (process.env.NEXT_PHASE === 'phase-production-build') {
        database = buildPhaseDeferred();
      } else {
        throw new Error(DATABASE_URL_ERROR);
      }
    } else {
      pool = new Pool({ connectionString });
      database = drizzle(pool, { schema });
    }
  }
  return database;
}
