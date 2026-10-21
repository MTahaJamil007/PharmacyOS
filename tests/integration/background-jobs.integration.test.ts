import type { Environment } from '@pharmacy/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DurableWorker } from '../../apps/worker/src/worker.js';
import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';
import {
  createBranchFixture,
  createStockedMedicine,
  jsonBody,
  type BranchFixture,
} from './harness/fixtures.js';

const workerEnvironment = {
  FBR_MODE: 'DISABLED',
  WORKER_HEALTH_FILE: '',
  WORKER_ID: 'background-jobs-worker',
} as Environment;

const SCHEDULED_JOBS = [
  'REFRESH_DASHBOARD_METRICS',
  'SNAPSHOT_INVENTORY_AVAILABILITY',
  'REFRESH_EXPIRY_RISK',
  'REFRESH_REORDER_SUGGESTIONS',
  'REFRESH_SHELF_RECOMMENDATIONS',
] as const;

/**
 * The refresh functions are covered elsewhere; these tests go through the worker's own job
 * loop, including the run bookkeeping that wraps every scheduled job, and through the owner
 * assistant endpoint including its audit row. Both once failed on every call because a
 * pre-stringified value was written to a jsonb column that must hold an object.
 */
describe('background jobs and assistant audit', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;
  let owner: BranchFixture;

  beforeAll(async () => {
    database = await createIsolatedDatabase('background_jobs');
    owner = await createBranchFixture(database, 'jobs', { roleCode: 'OWNER' });
    api = await createIntegrationApi(database.applicationUrl);
    await createStockedMedicine(database, owner.branchId, {
      name: 'Job Fixture Medicine',
      quantity: '40',
      salePrice: '12.00',
    });
  });

  afterAll(async () => {
    if (api) await api.close();
    if (database) await database.dispose();
  });

  it('runs every scheduled job through the worker loop and records an object summary', async () => {
    for (const jobType of SCHEDULED_JOBS) {
      await database.admin`
        insert into outbox_jobs (job_type, deduplication_key, payload, priority)
        values (
          ${jobType}, ${`test:${jobType}`},
          ${database.admin.json({ branchId: owner.branchId, runKey: `test-${jobType}` })}, 10
        )
      `;
    }
    const worker = new DurableWorker(database.application, workerEnvironment);
    let processed = 0;
    while (await worker.processNext()) processed += 1;
    expect(processed).toBe(SCHEDULED_JOBS.length);

    const runs = await database.admin<
      Array<{ job_name: string; status: string; summary_type: string; last_error: string | null }>
    >`
      select job_name, status, jsonb_typeof(result_summary) as summary_type, last_error
      from scheduled_job_runs where run_key like 'test-%' order by job_name
    `;
    expect(runs).toHaveLength(SCHEDULED_JOBS.length);
    for (const run of runs) {
      expect(run, run.job_name).toMatchObject({
        last_error: null,
        status: 'SUCCEEDED',
        summary_type: 'object',
      });
    }
    const jobs = await database.admin<Array<{ status: string }>>`
      select status from outbox_jobs where deduplication_key like 'test:%'
    `;
    expect(jobs.map((job) => job.status)).toEqual(SCHEDULED_JOBS.map(() => 'COMPLETED'));
  });

  it('answers an owner question and audits it with object metadata', async () => {
    const response = await api.app.inject({
      headers: owner.headers,
      method: 'POST',
      payload: { arguments: {}, question: 'How did sales go?', tool: 'get_sales_summary' },
      url: '/api/v1/owner-ai/chat',
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(jsonBody(response)).toMatchObject({ status: 'AI_DISABLED' });

    const [audit] = await database.admin<
      Array<{ arguments_type: string; usage_type: string; status: string }>
    >`
      select jsonb_typeof(tool_arguments) as arguments_type,
        jsonb_typeof(usage_metadata) as usage_type, status
      from ai_assistant_audits where branch_id = ${owner.branchId}
      order by id desc limit 1
    `;
    expect(audit).toEqual({ arguments_type: 'object', status: 'DISABLED', usage_type: 'object' });
  });
});
