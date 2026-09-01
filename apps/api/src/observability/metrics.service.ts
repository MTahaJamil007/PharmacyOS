import { Injectable } from '@nestjs/common';

const DURATION_BUCKETS_SECONDS = [0.05, 0.08, 0.15, 0.3, 1, 2, 5, 15] as const;

interface RequestMetric {
  count: number;
  durationSumSeconds: number;
  readonly buckets: number[];
}

function label(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, RequestMetric>();

  recordRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    const normalizedRoute = route
      .split('?')[0]!
      .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');
    const key = JSON.stringify([method.toUpperCase(), normalizedRoute, String(statusCode)]);
    const metric = this.requests.get(key) ?? {
      count: 0,
      durationSumSeconds: 0,
      buckets: DURATION_BUCKETS_SECONDS.map(() => 0),
    };
    metric.count += 1;
    metric.durationSumSeconds += durationSeconds;
    DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
      if (durationSeconds <= bucket) metric.buckets[index] = (metric.buckets[index] ?? 0) + 1;
    });
    this.requests.set(key, metric);
  }

  render(alertCounts: Readonly<Record<string, number>>): string {
    const lines = [
      '# HELP pharmacy_api_uptime_seconds Process uptime in seconds.',
      '# TYPE pharmacy_api_uptime_seconds gauge',
      `pharmacy_api_uptime_seconds ${Math.max(0, (Date.now() - this.startedAt) / 1000)}`,
      '# HELP pharmacy_http_requests_total HTTP requests completed.',
      '# TYPE pharmacy_http_requests_total counter',
      '# HELP pharmacy_http_request_duration_seconds HTTP request duration.',
      '# TYPE pharmacy_http_request_duration_seconds histogram',
    ];
    for (const [key, metric] of [...this.requests.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const parsed = JSON.parse(key) as [string, string, string];
      const labels = `method="${label(parsed[0])}",route="${label(parsed[1])}",status="${label(parsed[2])}"`;
      lines.push(`pharmacy_http_requests_total{${labels}} ${metric.count}`);
      DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
        lines.push(
          `pharmacy_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${metric.buckets[index] ?? 0}`,
        );
      });
      lines.push(
        `pharmacy_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${metric.count}`,
        `pharmacy_http_request_duration_seconds_sum{${labels}} ${metric.durationSumSeconds}`,
        `pharmacy_http_request_duration_seconds_count{${labels}} ${metric.count}`,
      );
    }
    lines.push(
      '# HELP pharmacy_operational_alerts Open or acknowledged operational alerts.',
      '# TYPE pharmacy_operational_alerts gauge',
    );
    for (const [type, count] of Object.entries(alertCounts).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(`pharmacy_operational_alerts{type="${label(type)}"} ${count}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
