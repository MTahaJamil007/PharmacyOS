export interface ScannerOptions {
  readonly maximumInterKeyMs?: number;
  readonly minimumLength?: number;
}

export class WedgeScannerBuffer {
  private buffer = '';
  private firstKeyAt = 0;
  private lastKeyAt = 0;
  private readonly maximumInterKeyMs: number;
  private readonly minimumLength: number;

  constructor(options: ScannerOptions = {}) {
    this.maximumInterKeyMs = options.maximumInterKeyMs ?? 35;
    this.minimumLength = options.minimumLength ?? 6;
  }

  push(key: string, timestamp: number): string | null {
    if (key === 'Enter') {
      const value = this.buffer;
      const averageGap =
        value.length > 1 ? (this.lastKeyAt - this.firstKeyAt) / (value.length - 1) : Infinity;
      this.reset();
      return value.length >= this.minimumLength && averageGap <= this.maximumInterKeyMs
        ? value
        : null;
    }
    if (key.length !== 1) return null;
    if (this.lastKeyAt > 0 && timestamp - this.lastKeyAt > this.maximumInterKeyMs * 2) {
      this.reset();
    }
    if (this.buffer.length === 0) this.firstKeyAt = timestamp;
    this.buffer += key;
    this.lastKeyAt = timestamp;
    return null;
  }

  reset(): void {
    this.buffer = '';
    this.firstKeyAt = 0;
    this.lastKeyAt = 0;
  }
}
