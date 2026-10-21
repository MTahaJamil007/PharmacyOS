import './load-environment.js';

import { createDatabase, type Database } from './index.js';

/**
 * Prepares a non-container PostgreSQL cluster for local development: the application login role
 * and the application database that `DATABASE_URL` names. The Compose stack does this from
 * `infra/docker/postgres-init-app-role.sh`; a native PostgreSQL installation has no equivalent
 * hook, so migrations fail with `3D000` and the API with `28P01`.
 *
 * Every step is idempotent and additive. Nothing is dropped and an existing role keeps its
 * memberships; only its password is aligned with `.env` so the application can authenticate.
 * Role names, database names, and the password are quoted by PostgreSQL's own `format`, because
 * neither identifiers nor the password of a utility statement can be bound as parameters.
 */

interface ClusterTarget {
  readonly applicationDatabase: string;
  readonly applicationPassword: string;
  readonly applicationRole: string;
  readonly maintenanceUrl: string;
}

function readTarget(): ClusterTarget {
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('Cluster bootstrap refused: this command is for local development only');
  }
  const applicationUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!applicationUrl) throw new Error('DATABASE_URL is required');
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required to administer the cluster');

  const application = new URL(applicationUrl);
  const applicationRole = decodeURIComponent(application.username);
  const applicationPassword = decodeURIComponent(application.password);
  const applicationDatabase = application.pathname.replace(/^\//, '');
  if (!applicationRole || !applicationPassword) {
    throw new Error('DATABASE_URL must contain the application role and its password');
  }
  if (!applicationDatabase) throw new Error('DATABASE_URL must name the application database');

  // The application database may not exist yet, so administer through the maintenance database.
  const maintenance = new URL(adminUrl);
  maintenance.pathname = '/postgres';
  return {
    applicationDatabase,
    applicationPassword,
    applicationRole,
    maintenanceUrl: maintenance.toString(),
  };
}

async function formatStatement(
  database: Database,
  template: string,
  values: readonly string[],
): Promise<string> {
  const [row] = await database<Array<{ statement: string }>>`
    select format(
      ${template}::text, ${values[0] ?? null}::text, ${values[1] ?? null}::text
    ) as statement
  `;
  if (!row) throw new Error('PostgreSQL did not return a formatted statement');
  return row.statement;
}

async function bootstrap(): Promise<void> {
  const target = readTarget();
  const database = createDatabase(target.maintenanceUrl, { max: 1 });
  try {
    const [role] = await database<Array<{ rolname: string }>>`
      select rolname from pg_roles where rolname = ${target.applicationRole}
    `;
    await database.unsafe(
      await formatStatement(
        database,
        role ? 'alter role %I login password %L' : 'create role %I login password %L',
        [target.applicationRole, target.applicationPassword],
      ),
    );
    process.stdout.write(
      role
        ? `Aligned the password of the existing role ${target.applicationRole}\n`
        : `Created role ${target.applicationRole}\n`,
    );

    const [existing] = await database<Array<{ datname: string }>>`
      select datname from pg_database where datname = ${target.applicationDatabase}
    `;
    if (existing) {
      process.stdout.write(`Database ${target.applicationDatabase} already exists\n`);
    } else {
      // The migration owner stays the administrator; the application role only receives the
      // grants that migration 006 makes.
      await database.unsafe(
        await formatStatement(database, 'create database %I', [target.applicationDatabase]),
      );
      process.stdout.write(`Created database ${target.applicationDatabase}\n`);
    }

    await database.unsafe(
      await formatStatement(database, 'grant connect on database %I to %I', [
        target.applicationDatabase,
        target.applicationRole,
      ]),
    );
    process.stdout.write(
      'Cluster is ready. Run npm run db:migrate, npm run db:seed, then ' +
        'npm run bootstrap:owner --workspace @pharmacy/api.\n',
    );
  } finally {
    await database.end();
  }
}

await bootstrap();
