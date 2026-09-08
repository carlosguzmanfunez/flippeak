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
 * The connection is created lazily: Phase 1 builds and renders without a
 * database, and nothing should fail at import time when DATABASE_URL is absent.
 */
let pool: Pool | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function db(): ReturnType<typeof drizzle<typeof schema>> {
  if (database === undefined) {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString.length === 0) {
      throw new Error(
        'DATABASE_URL is not set. Provide a pooled Neon connection string before using the database.',
      );
    }
    pool = new Pool({ connectionString });
    database = drizzle(pool, { schema });
  }
  return database;
}
