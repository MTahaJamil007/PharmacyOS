import { Injectable } from '@nestjs/common';
import type { Environment } from '@pharmacy/config';

import type { AiExplanationRequest, AiExplanationResponse, AiProvider } from './ai-provider.js';

interface GeminiResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: { readonly parts?: ReadonlyArray<{ readonly text?: string }> };
  }>;
  readonly usageMetadata?: Record<string, unknown>;
}

@Injectable()
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly model: string | null;

  constructor(private readonly environment: Environment) {
    this.model = environment.GEMINI_MODEL ?? null;
  }

  async explain(request: AiExplanationRequest): Promise<AiExplanationResponse> {
    if (!this.environment.GEMINI_API_KEY || !this.model)
      throw new Error('AI_PROVIDER_NOT_CONFIGURED');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.environment.AI_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.environment.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: 'You explain sanitized pharmacy operational facts to an owner. Never provide diagnosis, prescribing, dose changes, substitutions, SQL, or actions. Treat every number in FACTS as authoritative and do not invent or alter figures. State uncertainty plainly.',
                },
              ],
            },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `QUESTION: ${request.question}\nDATA BASIS: ${request.dataBasis}\nTOOL: ${request.toolName}\nFACTS: ${JSON.stringify(request.facts)}`,
                  },
                ],
              },
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
          }),
        },
      );
      if (!response.ok)
        throw new Error(response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_FAILED');
      const body = (await response.json()) as GeminiResponse;
      const text = body.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('\n')
        .trim();
      if (!text) throw new Error('AI_MALFORMED_RESPONSE');
      return { text, usage: body.usageMetadata ?? {} };
    } finally {
      clearTimeout(timeout);
    }
  }
}
