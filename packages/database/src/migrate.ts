import './load-environment.js';

import { runMigrations } from './migrations.js';

async function migrate(): Promise<void> {
  const connectionString = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required');
  }

  await runMigrations(connectionString, {
    onApplied: (file) => process.stdout.write(`Applied ${file}\n`),
  });
}

await migrate();
