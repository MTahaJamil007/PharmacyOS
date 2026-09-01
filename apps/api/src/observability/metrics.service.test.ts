import { describe, expect, it } from 'vitest';

import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  it('emits bounded route labels, duration buckets, and operational gauges', () => {
    const metrics = new MetricsService();
    metrics.recordRequest('get', '/api/v1/customers/123', 200, 0.07);
    const output = metrics.render({ FAILED_JOB: 2 });
    expect(output).toContain('route="/api/v1/customers/:id"');
    expect(output).toContain('le="0.08"} 1');
    expect(output).toContain('pharmacy_operational_alerts{type="FAILED_JOB"} 2');
  });
});
