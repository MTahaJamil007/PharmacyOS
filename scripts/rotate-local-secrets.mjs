import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

class LocalSecretRotator {
  static #keys = ['SESSION_SECRET', 'DEVELOPMENT_SEED_PASSWORD', 'BOOTSTRAP_OWNER_PASSWORD'];

  constructor(environmentPath) {
    this.environmentPath = environmentPath;
  }

  async rotate() {
    const source = await readFile(this.environmentPath, 'utf8');
    const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
    const values = new Map(LocalSecretRotator.#keys.map((key) => [key, this.#generate()]));
    const found = new Set();

    const lines = source.split(/\r?\n/).map((line) => {
      const match = /^([^#=]+)=(.*)$/.exec(line);
      const key = match?.[1]?.trim();
      if (!key || !values.has(key)) return line;

      found.add(key);
      return `${key}=${values.get(key)}`;
    });

    const missing = LocalSecretRotator.#keys.filter((key) => !found.has(key));
    if (missing.length > 0) {
      throw new Error(`Cannot rotate missing environment keys: ${missing.join(', ')}`);
    }

    await writeFile(this.environmentPath, lines.join(lineEnding), {
      encoding: 'utf8',
      mode: 0o600,
    });
    console.log(`Rotated ${LocalSecretRotator.#keys.join(', ')} in .env`);
  }

  #generate() {
    return randomBytes(32).toString('base64url');
  }
}

const rotator = new LocalSecretRotator(resolve(repositoryRoot, '.env'));
await rotator.rotate();
