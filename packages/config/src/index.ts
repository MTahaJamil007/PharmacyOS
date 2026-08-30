import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

config({ path: join(repositoryRoot, '.env'), quiet: true });

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().url(),
  DATABASE_ADMIN_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(720).default(30),
  RESERVATION_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(8),
  WORKER_ID: z.string().min(1).default('worker-local-1'),
  WORKER_HEALTH_FILE: z.string().default(''),
  FBR_MODE: z
    .enum(['DISABLED', 'SANDBOX', 'PRAL_DI_API', 'LICENSED_INTEGRATOR_API', 'WINDOWS_IMS_BRIDGE'])
    .default('DISABLED'),
  TRUST_PROXY: booleanFromString.default(false),
  AI_ENABLED: booleanFromString.default(false),
  AI_PROVIDER: z.enum(['disabled', 'gemini']).default('disabled'),
  GEMINI_API_KEY: z.string().min(1).optional().or(z.literal('')),
  GEMINI_MODEL: z.string().min(1).optional().or(z.literal('')),
  AI_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(8).default(4),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(10),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
