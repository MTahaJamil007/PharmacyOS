import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@pharmacy/database';

import { DATABASE } from '../database.module.js';

interface JobSummaryRow {
  readonly failed: number;
  readonly retryable: number;
  readonly processing: number;
  readonly stale_processing: number;
}

interface FailedJobRow {
  readonly id: string;
  readonly job_type: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FailedJobsResponse {
  readonly summary: {
    readonly failed: number;
    readonly retryable: number;
    readonly processing: number;
    readonly staleProcessing: number;
  };
  readonly jobs: ReadonlyArray<{
    readonly id: string;
    readonly jobType: string;
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly lastError: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }>;
}

@Injectable()
export class JobsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async listFailed(limit: number): Promise<FailedJobsResponse> {
    const [[summary], jobs] = await Promise.all([
      this.database<JobSummaryRow[]>`
        select
          (select count(*)::int from outbox_jobs where status = 'FAILED') as failed,
          (select count(*)::int from outbox_jobs where status = 'RETRYABLE') as retryable,
          (select count(*)::int from outbox_jobs where status = 'PROCESSING') as processing,
          (select count(*)::int from outbox_jobs
            where status = 'PROCESSING'
              and locked_at < now() - interval '5 minutes') as stale_processing
      `,
      this.database<FailedJobRow[]>`
        select id::text, job_type, attempts, max_attempts, last_error,
          created_at::text, updated_at::text
        from outbox_jobs
        where status = 'FAILED'
        order by created_at desc, id desc
        limit ${limit}
      `,
    ]);

    return {
      summary: {
        failed: summary?.failed ?? 0,
        retryable: summary?.retryable ?? 0,
        processing: summary?.processing ?? 0,
        staleProcessing: summary?.stale_processing ?? 0,
      },
      jobs: jobs.map((job) => ({
        id: job.id,
        jobType: job.job_type,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        lastError: job.last_error,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      })),
    };
  }
}
