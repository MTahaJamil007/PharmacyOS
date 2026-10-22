import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';
import { shelfPlannerScenario } from './scenarios/shelf-planner.js';

describe('Phase 6 shelf planner', () => {
  let database: IsolatedDatabase;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase6_shelf_planner');
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('plans, suggests, and applies shelf layouts against real migrations', async () => {
    await shelfPlannerScenario(database.admin, (name, ok, detail = '') => {
      expect({ check: name, ok, detail: ok ? '' : detail }).toEqual({
        check: name,
        ok: true,
        detail: '',
      });
    });
  });
});
