/**
 * Vitest setup (Patch A3).
 *
 * Runs inside every test file's environment, before the test module is imported,
 * so the integration guard is applied before any suite can reach the database
 * client. With no `RUN_*` flag set it is a no-op and the regular offline suite is
 * unaffected.
 */
import { enforceIntegrationDatabase } from './integration-db-guard';

enforceIntegrationDatabase();
