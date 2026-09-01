import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type ComposeService = {
  command?: string[];
  depends_on?: Record<string, { condition?: string }>;
  deploy?: { resources?: { limits?: { cpus?: string; memory?: string; pids?: number } } };
  environment?: Record<string, string>;
  healthcheck?: { test?: string[] };
  networks?: string[];
  pids_limit?: number;
  ports?: string[];
  secrets?: string[];
  volumes?: Array<string | Record<string, unknown>>;
};

type ComposeFile = {
  networks?: Record<string, { internal?: boolean }>;
  services?: Record<string, ComposeService>;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readRepositoryFile(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function service(compose: ComposeFile, name: string): ComposeService {
  const configuredService = compose.services?.[name];
  expect(configuredService, `Compose service ${name} must exist`).toBeDefined();
  return configuredService as ComposeService;
}

describe('production deployment contract', () => {
  const composeSource = readRepositoryFile('infra/docker/compose.yaml');
  const compose = parse(composeSource) as ComposeFile;

  it('gates runtime services on a successful migration', () => {
    const migrate = service(compose, 'migrate');
    expect(migrate.environment?.NODE_ENV).toBe('production');
    expect(migrate.command).toEqual(['node', 'packages/database/dist/migrate.js']);
    expect(migrate.depends_on?.postgres?.condition).toBe('service_healthy');

    for (const name of ['api', 'worker', 'backup']) {
      expect(service(compose, name).depends_on?.migrate?.condition).toBe(
        'service_completed_successfully',
      );
    }

    expect(service(compose, 'web').depends_on?.api?.condition).toBe('service_healthy');
  });

  it('pins production settings, health checks, and resource ceilings', () => {
    expect(service(compose, 'api').environment?.NODE_ENV).toBe('production');
    expect(service(compose, 'worker').environment?.NODE_ENV).toBe('production');

    for (const name of ['postgres', 'redis', 'api', 'worker', 'backup', 'web']) {
      expect(service(compose, name).healthcheck?.test, `${name} healthcheck`).toBeDefined();
    }

    for (const name of ['postgres', 'redis', 'migrate', 'api', 'worker', 'backup', 'web']) {
      const configuredService = service(compose, name);
      expect(configuredService.deploy?.resources?.limits?.cpus, `${name} CPU limit`).toBeDefined();
      expect(
        configuredService.deploy?.resources?.limits?.memory,
        `${name} memory limit`,
      ).toBeDefined();
      expect(configuredService.pids_limit, `${name} process limit`).toBeGreaterThan(0);
      expect(configuredService.deploy?.resources?.limits?.pids).toBe(configuredService.pids_limit);
    }
  });

  it('separates application and administrative database credentials', () => {
    expect(service(compose, 'api').environment?.DATABASE_URL).toContain('postgres://pharmacy_app:');
    expect(service(compose, 'worker').environment?.DATABASE_URL).toContain(
      'postgres://pharmacy_app:',
    );
    expect(service(compose, 'migrate').environment?.DATABASE_ADMIN_URL).toContain(
      'postgres://postgres:',
    );
    expect(service(compose, 'backup').environment?.DATABASE_ADMIN_URL).toContain(
      'postgres://postgres:',
    );

    const roleInitializer = readRepositoryFile('infra/docker/postgres-init-app-role.sh');
    expect(roleInitializer).toContain('-v ON_ERROR_STOP=1');
    expect(roleInitializer).toContain('create role pharmacy_app login password %L');
  });

  it('mounts PostgreSQL 18 data at the supported cluster root', () => {
    expect(service(compose, 'postgres').volumes).toContain('postgres-data:/var/lib/postgresql');
  });

  it('exposes TLS and keeps internal services off the host network', () => {
    expect(service(compose, 'web').ports).toEqual([
      '${HTTP_PORT:-80}:80',
      '${HTTPS_PORT:-443}:443',
    ]);
    expect(compose.networks?.backend?.internal).toBe(true);
    expect(compose.networks?.edge?.internal).not.toBe(true);
    expect(service(compose, 'web').networks).toEqual(['backend', 'edge']);
    for (const name of ['postgres', 'redis', 'migrate', 'backup']) {
      expect(service(compose, name).networks).toEqual(['backend']);
    }
    expect(service(compose, 'api').networks).toEqual(['backend', 'egress']);
    expect(service(compose, 'worker').networks).toEqual(['backend', 'egress']);
    expect(compose.networks?.egress?.internal).not.toBe(true);

    const caddyfile = readRepositoryFile('infra/docker/Caddyfile');
    expect(caddyfile).toContain('tls internal');
    expect(caddyfile).toMatch(/handle \/healthz[\s\S]*respond "ok" 200/);
    expect(caddyfile).toContain('Strict-Transport-Security "max-age=31536000"');
    expect(caddyfile).toContain('Content-Security-Policy');
    expect(caddyfile).toMatch(/http:\/\/.*redir https:\/\//s);

    const webDockerfile = readRepositoryFile('infra/docker/Dockerfile.web');
    expect(webDockerfile).toMatch(
      /npm run build --workspace @pharmacy\/shared[\s\S]*npm run build --workspace @pharmacy\/web/,
    );

    for (const path of ['infra/docker/Dockerfile.api', 'infra/docker/Dockerfile.worker']) {
      const dockerfile = readRepositoryFile(path);
      expect(dockerfile).toContain('npm ci --omit=dev --ignore-scripts');
    }
  });

  it('requires encrypted external backups and automated restore drills', () => {
    const backup = service(compose, 'backup');
    expect(backup.secrets).toContain('backup_age_identity');
    expect(backup.environment?.BACKUP_AGE_RECIPIENT).toBeDefined();
    expect(backup.environment?.RESTORE_DRILL_DAY).toBeDefined();

    const script = readRepositoryFile('infra/docker/backup-service.sh');
    expect(script).toMatch(/pg_dump[\s\S]*\| age --recipient/);
    expect(script).toContain('DAILY_KEEP=7');
    expect(script).toContain('WEEKLY_KEEP=4');
    expect(script).toContain('MONTHLY_KEEP=3');
    expect(script).toContain('| pg_restore --exit-on-error');
    expect(script).toContain('sha256sum -c');
    expect(script).not.toContain('sha256sum --check');
    expect(script).toContain("record_start 'RESTORE_DRILL'");
    expect(script).toContain('psql "$restore_app_url"');
    expect(script).toContain('flock -n 9');

    const entrypoint = readRepositoryFile('infra/docker/backup-entrypoint.sh');
    expect(entrypoint).toContain('install -o backup -g backup -m 0400');
    expect(entrypoint).toContain('export BACKUP_AGE_IDENTITY_FILE="$identity_runtime"');
  });

  it('never sends local backup identities into a Docker build context', () => {
    const dockerignore = readRepositoryFile('.dockerignore');
    expect(dockerignore.split(/\r?\n/)).toContain('infra/docker/secrets');
  });
});
