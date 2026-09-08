/**
 * FlipPeak canonical database schema.
 *
 * This module is the single entry point consumed by the Drizzle client
 * (`src/db/client.ts`) and by drizzle-kit (`drizzle.config.ts`). Table
 * definitions live in their own domain files and are re-exported here; nothing
 * is ever defined twice.
 *
 * Phase 2 adds authentication. Phase 3 adds the campaign domain. Later database
 * domains will be introduced only after their respective architecture reviews.
 */

export * from './auth-schema';
export * from './campaign-schema';
export * from './funding-schema';
export * from './payment-schema';
