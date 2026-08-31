import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { GeminiProvider } from './gemini.provider.js';
import { OwnerAiService } from './owner-ai.service.js';
import type { OwnerToolsService } from './owner-tools.service.js';

const user: AuthenticatedUser = {
  branchId: '1',
  displayName: 'Owner',
  id: '2',
  permissions: [],
  sessionId: '3',
  terminalId: '4',
  username: 'owner',
};
const request = {
  arguments: {},
  question: 'How did sales perform?',
  tool: 'get_sales_summary' as const,
};
const toolResult = {
  dataBasis: 'Finalized sales for 2026-08-01 through 2026-08-31',
  facts: { grossSales: '10.00', invoiceCount: '2' },
  reportPath: '/owner?report=sales',
};

function createSubject(
  options: {
    enabled?: boolean;
    providerResult?: { text: string; usage: Record<string, unknown> };
    providerError?: Error;
    toolError?: Error;
  } = {},
) {
  const database = Object.assign(
    vi
      .fn()
      .mockResolvedValueOnce([{ requests: 0 }])
      .mockResolvedValue([]),
    { json: vi.fn((value: unknown) => value) },
  );
  const execute = options.toolError
    ? vi.fn().mockRejectedValue(options.toolError)
    : vi.fn().mockResolvedValue(toolResult);
  const explain = options.providerError
    ? vi.fn().mockRejectedValue(options.providerError)
    : vi.fn().mockResolvedValue(
        options.providerResult ?? {
          text: 'Gross sales were 10.00 across 2 invoices.',
          usage: { inputTokens: 20 },
        },
      );
  const environment = {
    AI_ENABLED: options.enabled ?? true,
    AI_PROVIDER: options.enabled === false ? 'disabled' : 'gemini',
    AI_RATE_LIMIT_PER_MINUTE: 10,
    GEMINI_API_KEY: 'private-api-key',
    GEMINI_MODEL: 'test-model',
  } as Environment;
  const service = new OwnerAiService(
    database as unknown as Database,
    environment,
    { explain, model: 'test-model', name: 'gemini' } as unknown as GeminiProvider,
    { execute } as unknown as OwnerToolsService,
  );
  return { database, execute, explain, service };
}

describe('OwnerAiService isolation', () => {
  it('returns deterministic facts without calling a disabled provider', async () => {
    const { database, explain, service } = createSubject({ enabled: false });

    await expect(service.chat(user, request)).resolves.toEqual({
      dataBasis: toolResult.dataBasis,
      explanation: null,
      facts: toolResult.facts,
      reportPath: toolResult.reportPath,
      status: 'AI_DISABLED',
    });
    expect(explain).not.toHaveBeenCalled();
    expect(JSON.stringify(database.mock.calls)).not.toContain(request.question);
    expect(JSON.stringify(database.mock.calls)).not.toContain('private-api-key');
  });

  it('rejects a contradictory generated number while preserving authoritative facts', async () => {
    const { database, service } = createSubject({
      providerResult: { text: 'Gross sales were 999.00.', usage: {} },
    });

    await expect(service.chat(user, request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify(database.mock.calls)).toContain('AI_UNSUPPORTED_NUMERIC_CLAIM');
  });

  it('maps a tool failure to a safe isolated error without persisting its private detail', async () => {
    const { database, explain, service } = createSubject({
      toolError: new Error('customer-secret-should-not-be-stored'),
    });

    await expect(service.chat(user, request)).rejects.toThrow(
      'Owner report is temporarily unavailable; point-of-sale remains available',
    );
    expect(explain).not.toHaveBeenCalled();
    expect(JSON.stringify(database.mock.calls)).toContain('AI_TOOL_FAILED');
    expect(JSON.stringify(database.mock.calls)).not.toContain(
      'customer-secret-should-not-be-stored',
    );
  });

  it('preserves the tool-level authorization re-check', async () => {
    const { database, service } = createSubject({
      toolError: new ForbiddenException('Tool access is not permitted'),
    });

    await expect(service.chat(user, request)).rejects.toMatchObject({ status: 403 });
    expect(database).toHaveBeenCalledTimes(1);
  });
});
