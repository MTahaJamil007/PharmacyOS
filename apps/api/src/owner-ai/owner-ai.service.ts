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
    const toolResult = await this.tools.execute(user, request);
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
      const code = error instanceof Error ? error.message : 'AI_PROVIDER_FAILED';
      const status = error instanceof Error && error.name === 'AbortError' ? 'TIMED_OUT' : 'FAILED';
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
