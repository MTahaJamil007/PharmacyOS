import { describe, expect, it, vi } from 'vitest';

import { WorkerHeartbeat } from './heartbeat.js';

describe('WorkerHeartbeat', () => {
  it('throttles filesystem writes while allowing a forced initial heartbeat', async () => {
    const writer = vi.fn(() => Promise.resolve());
    const heartbeat = new WorkerHeartbeat('/tmp/worker-health', 15_000, writer);

    await heartbeat.touch(true, 1_000);
    await heartbeat.touch(false, 10_000);
    await heartbeat.touch(false, 16_000);

    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer).toHaveBeenNthCalledWith(1, '/tmp/worker-health', new Date(1_000).toISOString());
    expect(writer).toHaveBeenNthCalledWith(2, '/tmp/worker-health', new Date(16_000).toISOString());
  });

  it('is disabled when no health-file path is configured', async () => {
    const writer = vi.fn(() => Promise.resolve());
    const heartbeat = new WorkerHeartbeat('', 15_000, writer);

    await heartbeat.touch(true, 1_000);

    expect(writer).not.toHaveBeenCalled();
  });
});
