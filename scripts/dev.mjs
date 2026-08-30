import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const workspaces = ['@pharmacy/api', '@pharmacy/worker', '@pharmacy/web'];
const children = [];
let shuttingDown = false;

function stopChildTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) stopChildTree(child);
  process.exit(exitCode);
}

for (const workspace of workspaces) {
  const child = spawn(npmCommand, ['run', 'dev', '--workspace', workspace], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    windowsHide: false,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`[dev] ${workspace} failed to start: ${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const status = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
    console.error(`[dev] ${workspace} stopped with ${status}`);
    shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
