import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import type { OwnerAiChatRequest } from '@pharmacy/shared';
import { createHash } from 'node:crypto';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DATABASE, ENVIRONMENT } from '../database.module.js';
import type { AiProvider } from './ai-provider.js';
import { GeminiProvider } from './gemini.provider.js';
import { OwnerToolsService } from './owner-tools.service.js';

function normalizeNumericToken(token: string): string {
  const negative = token.startsWith('-');
  const unsigned = negative ? token.slice(1) : token;
  const [integerPart = '0', fractionalPart = ''] = unsigned.split('.');
  const integer = integerPart.replace(/^0+(?=\d)/, '') || '0';
  const fractional = fractionalPart.replace(/0+$/, '');
  const normalized = fractional.length > 0 ? `${integer}.${fractional}` : integer;
  return negative && normalized !== '0' ? `-${normalized}` : normalized;
}

function numericTokens(value: string): Set<string> {
  return new Set(
    [...value.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => normalizeNumericToken(match[0])),
  );
}

function assertNumericClaimsAreGrounded(
  explanation: string,
  facts: unknown,
  dataBasis: string,
): void {
  const permitted = numericTokens(`${JSON.stringify(facts)}\n${dataBasis}`);
  const unsupported = [...numericTokens(explanation)].filter((token) => !permitted.has(token));
  if (unsupported.length > 0) throw new Error('AI_UNSUPPORTED_NUMERIC_CLAIM');
}

@Injectable()
export class OwnerAiService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(GeminiProvider) private readonly geminiProvider: GeminiProvider,
    @Inject(OwnerToolsService) private readonly tools: OwnerToolsService,
  ) {}

  async chat(
    user: AuthenticatedUser,
    request: OwnerAiChatRequest,
  ): Promise<Record<string, unknown>> {
    const [rate] = await this.database<Array<{ requests: number }>>`
      select count(*)::int as requests from ai_assistant_audits
      where user_id = ${user.id} and created_at >= now() - interval '1 minute'
    `;
    if ((rate?.requests ?? 0) >= this.environment.AI_RATE_LIMIT_PER_MINUTE) {
      await this.audit(user, request, 'RATE_LIMITED', 0, {}, 'AI_RATE_LIMITED');
      throw new HttpException(
        'Owner assistant rate limit reached; try again shortly',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const started = Date.now();
    let toolResult: Awaited<ReturnType<OwnerToolsService['execute']>>;
    try {
      toolResult = await this.tools.execute(user, request);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      await this.audit(user, request, 'FAILED', Date.now() - started, {}, 'AI_TOOL_FAILED');
      throw new ServiceUnavailableException(
        'Owner report is temporarily unavailable; point-of-sale remains available',
      );
    }
    if (!this.environment.AI_ENABLED || this.environment.AI_PROVIDER === 'disabled') {
      await this.audit(user, request, 'DISABLED', Date.now() - started, {}, null);
      return {
        facts: toolResult.facts,
        explanation: null,
        status: 'AI_DISABLED',
        dataBasis: toolResult.dataBasis,
        reportPath: toolResult.reportPath,
      };
    }

    const provider: AiProvider = this.geminiProvider;
    try {
      const response = await provider.explain({
        question: request.question,
        toolName: request.tool,
        dataBasis: toolResult.dataBasis,
        facts: toolResult.facts,
      });
      assertNumericClaimsAreGrounded(response.text, toolResult.facts, toolResult.dataBasis);
      await this.audit(user, request, 'SUCCEEDED', Date.now() - started, response.usage, null);
      return {
        facts: toolResult.facts,
        explanation: response.text,
        status: 'AVAILABLE',
        provider: provider.name,
        model: provider.model,
        dataBasis: toolResult.dataBasis,
        reportPath: toolResult.reportPath,
      };
    } catch (error) {
      const status = error instanceof Error && error.name === 'AbortError' ? 'TIMED_OUT' : 'FAILED';
      const knownCodes = new Set([
        'AI_MALFORMED_RESPONSE',
        'AI_PROVIDER_FAILED',
        'AI_PROVIDER_NOT_CONFIGURED',
        'AI_RATE_LIMITED',
        'AI_UNSUPPORTED_NUMERIC_CLAIM',
      ]);
      const code =
        status === 'TIMED_OUT'
          ? 'AI_PROVIDER_TIMED_OUT'
          : error instanceof Error && knownCodes.has(error.message)
            ? error.message
            : 'AI_PROVIDER_FAILED';
      await this.audit(user, request, status, Date.now() - started, {}, code);
      throw new ServiceUnavailableException(
        'Owner assistant explanation is unavailable; deterministic reports remain available',
      );
    }
  }

  private async audit(
    user: AuthenticatedUser,
    request: OwnerAiChatRequest,
    status: 'SUCCEEDED' | 'DISABLED' | 'RATE_LIMITED' | 'FAILED' | 'TIMED_OUT',
    latencyMs: number,
    usage: Record<string, unknown>,
    errorCode: string | null,
  ): Promise<void> {
    const questionHash = createHash('sha256').update(request.question).digest();
    await this.database`
      insert into ai_assistant_audits (
        branch_id, user_id, question_hash, tool_name, tool_arguments,
        provider, model, status, latency_ms, usage_metadata, error_code
      ) values (
        ${user.branchId}, ${user.id}, ${questionHash}, ${request.tool},
        ${JSON.stringify(request.arguments, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        )}::jsonb, ${this.environment.AI_PROVIDER},
        ${this.environment.AI_ENABLED ? (this.environment.GEMINI_MODEL ?? null) : null}, ${status},
        ${latencyMs}, ${JSON.stringify(usage)}::jsonb, ${errorCode}
      )
    `;
  }
}
