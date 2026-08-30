import type { FastifyRequest } from 'fastify';

export interface AuthenticatedUser {
  readonly id: string;
  readonly branchId: string;
  readonly terminalId: string;
  readonly username: string;
  readonly displayName: string;
  readonly permissions: readonly string[];
  readonly sessionId: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  authenticatedUser: AuthenticatedUser;
}
