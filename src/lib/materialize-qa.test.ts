import { describe, expect, it } from 'vitest';
import { settleAndMaterialize } from '@/lib/economic-service';

/** Maintenance: materialize the QA run that is economically dead but stale. */
describe.skipIf(process.env.RUN_MAT_QA !== '1')('materialize QA run', () => {
  it('materializes 292af90b (economically exhausted)', { timeout: 20_000 }, async () => {
    expect(await settleAndMaterialize('292af90b-de08-42f6-8d4f-6aee4be0a337')).toEqual({
      ok: true,
      runId: '292af90b-de08-42f6-8d4f-6aee4be0a337',
    });
  });
});
