import { parseEnvironment } from '@pharmacy/config';
import { createDatabase } from '@pharmacy/database';

import { DurableWorker } from './worker.js';

const environment = parseEnvironment();
const database = createDatabase(environment.DATABASE_URL, { max: 5 });
const controller = new AbortController();

for (const event of ['SIGINT', 'SIGTERM'] as const) {
  process.on(event, () => controller.abort());
}

try {
  await new DurableWorker(database, environment).run(controller.signal);
} finally {
  await database.end({ timeout: 5 });
}
