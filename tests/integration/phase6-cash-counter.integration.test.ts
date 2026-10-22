import { parseEnvironment } from '@pharmacy/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';
import { cashCounterScenario } from './scenarios/cash-counter.js';

describe('Phase 6 cash counter modes', () => {
  let database: IsolatedDatabase;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase6_cash_counter');
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('runs the cash counter queue and the no-session invoice mode against real migrations', async () => {
    const environment = parseEnvironment({
      AI_ENABLED: 'false',
      DATABASE_URL: database.applicationUrl,
      FBR_MODE: 'DISABLED',
      NODE_ENV: 'test',
      SESSION_SECRET: 'phase6-cash-counter-session-secret-32-bytes!',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      WORKER_HEALTH_FILE: 'phase6-cash-counter-worker-health.json',
      WORKER_ID: 'phase6-cash-counter-worker',
    });
    await cashCounterScenario(database.admin, environment, (name, ok, detail = '') => {
      expect({ check: name, ok, detail: ok ? '' : detail }).toEqual({
        check: name,
        ok: true,
        detail: '',
      });
    });
  });
});
