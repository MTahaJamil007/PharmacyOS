import type { Database } from '@pharmacy/database';
import { describe, expect, it, vi } from 'vitest';

import { JobsService } from './jobs.service.js';

describe('JobsService', () => {
  it('returns operational counts and a bounded failed-job projection', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ failed: 2, retryable: 3, processing: 1, stale_processing: 1 }])
      .mockResolvedValueOnce([
        {
          id: '42',
          job_type: 'FBR_SUBMIT',
          attempts: 10,
          max_attempts: 10,
          last_error: 'adapter unavailable',
          created_at: '2026-08-30T00:00:00.000Z',
          updated_at: '2026-08-30T01:00:00.000Z',
        },
      ]);
    const service = new JobsService(query as unknown as Database);

    const result = await service.listFailed(20);

    expect(query).toHaveBeenCalledTimes(2);
    expect(result.summary).toEqual({ failed: 2, retryable: 3, processing: 1, staleProcessing: 1 });
    expect(result.jobs).toEqual([
      {
        id: '42',
        jobType: 'FBR_SUBMIT',
        attempts: 10,
        maxAttempts: 10,
        lastError: 'adapter unavailable',
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T01:00:00.000Z',
      },
    ]);
  });
});
