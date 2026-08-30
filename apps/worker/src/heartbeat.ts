import { writeFile } from 'node:fs/promises';

type HeartbeatWriter = (path: string, data: string) => Promise<void>;

export class WorkerHeartbeat {
  private lastWrittenAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly path: string,
    private readonly intervalMilliseconds = 15_000,
    private readonly writer: HeartbeatWriter = (path, data) => writeFile(path, data, 'utf8'),
  ) {}

  async touch(force = false, now = Date.now()): Promise<void> {
    if (!this.path || (!force && now - this.lastWrittenAt < this.intervalMilliseconds)) return;
    await this.writer(this.path, new Date(now).toISOString());
    this.lastWrittenAt = now;
  }
}
