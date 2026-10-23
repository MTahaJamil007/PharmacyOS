import { parseEnvironment } from '@pharmacy/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';
import { phase7InventoryScenario } from './scenarios/phase7-inventory.js';

describe('Phase 7 stock work and several cash counters', () => {
  let database: IsolatedDatabase;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase7_inventory');
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('receives by scan, offers exact alternatives, counts requests, and splits counters', async () => {
    const environment = parseEnvironment({
      AI_ENABLED: 'false',
      DATABASE_URL: database.applicationUrl,
      FBR_MODE: 'DISABLED',
      NODE_ENV: 'test',
      SESSION_SECRET: 'phase7-inventory-session-secret-32-bytes!!',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      WORKER_HEALTH_FILE: 'phase7-inventory-worker-health.json',
      WORKER_ID: 'phase7-inventory-worker',
    });
    await phase7InventoryScenario(database.admin, environment, (name, ok, detail = '') => {
      expect({ check: name, ok, detail: ok ? '' : detail }).toEqual({
        check: name,
        ok: true,
        detail: '',
      });
    });
  });
});
