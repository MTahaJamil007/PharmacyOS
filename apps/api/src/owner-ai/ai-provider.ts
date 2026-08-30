export interface AiExplanationRequest {
  readonly question: string;
  readonly toolName: string;
  readonly dataBasis: string;
  readonly facts: unknown;
}

export interface AiExplanationResponse {
  readonly text: string;
  readonly usage: Record<string, unknown>;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string | null;
  explain(request: AiExplanationRequest): Promise<AiExplanationResponse>;
}
