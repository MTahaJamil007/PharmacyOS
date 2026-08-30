import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

config({ path: join(repositoryRoot, '.env'), quiet: true });
