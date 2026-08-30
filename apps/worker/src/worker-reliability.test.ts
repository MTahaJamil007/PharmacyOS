import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import { describe, expect, it, vi } from 'vitest';

import { WorkerHeartbeat } from './heartbeat.js';
import { DurableWorker } from './worker.js';

type MaintenanceSubject = {
  enqueueOperationalJobs(): Promise<void>;
  reclaimStaleJobs(): Promise<number>;
};

const environment = {
  WORKER_ID: 'worker-test-1',
  WORKER_HEALTH_FILE: '',
  FBR_MODE: 'DISABLED',
} as Environment;

function isTemplateStrings(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && 'raw' in value;
}

function sqlText(call: unknown[] | undefined): string {
  const strings = call?.[0];
  return isTemplateStrings(strings) ? strings.join(' ') : '';
}

describe('DurableWorker reliability', () => {
  it('schedules reservation expiry every minute alongside branch jobs', async () => {
    const query = Object.assign(
      vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: '7', local_date: '2026-08-30' }])
        .mockResolvedValue([]),
      { json: vi.fn((value: unknown) => value) },
    );
    const worker = new DurableWorker(query as unknown as Database, environment);

    await (worker as unknown as MaintenanceSubject).enqueueOperationalJobs();

    expect(query).toHaveBeenCalledTimes(6);
    expect(sqlText(query.mock.calls[0])).toContain("'EXPIRE_RESERVATIONS'");
    expect(sqlText(query.mock.calls[0])).toContain("'{}'::jsonb, 20");
    expect(query.mock.calls[0]?.[1]).toMatch(/^reservation-expiry:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('reclaims stale locks inside one skip-locked transaction', async () => {
    let queryNumber = 0;
    const transaction = vi.fn((firstArgument: unknown) => {
      if (!isTemplateStrings(firstArgument)) return firstArgument;
      queryNumber += 1;
      return Promise.resolve(queryNumber === 1 ? [{ id: '11' }, { id: '12' }] : []);
    });
    const database = Object.assign(vi.fn(), {
      begin: vi.fn(async (operation: (client: typeof transaction) => Promise<number>) =>
        operation(transaction),
      ),
    });
    const worker = new DurableWorker(database as unknown as Database, environment);

    const reclaimed = await (worker as unknown as MaintenanceSubject).reclaimStaleJobs();

    expect(reclaimed).toBe(2);
    expect(database.begin).toHaveBeenCalledOnce();
    const queries = transaction.mock.calls.filter((call) => isTemplateStrings(call[0]));
    expect(queries).toHaveLength(3);
    expect(sqlText(queries[0])).toContain("status = 'PROCESSING'");
    expect(sqlText(queries[0])).toContain("interval '5 minutes'");
    expect(sqlText(queries[0])).toContain('for update skip locked');
  });

  it('releases a claimed job when its attempt record cannot be written', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: '19',
          job_type: 'EXPIRE_RESERVATIONS',
          payload: {},
          attempts: 1,
          max_attempts: 10,
        },
      ])
      .mockRejectedValueOnce(new Error('attempt insert unavailable'))
      .mockResolvedValueOnce([]);
    const worker = new DurableWorker(
      query as unknown as Database,
      environment,
      new WorkerHeartbeat(''),
    );

    await expect(worker.processNext()).rejects.toThrow('attempt insert unavailable');

    expect(query).toHaveBeenCalledTimes(3);
    expect(sqlText(query.mock.calls[2])).toContain('locked_at = null');
    expect(query.mock.calls[2]?.[1]).toBe('RETRYABLE');
  });
});
