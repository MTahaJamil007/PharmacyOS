const MAXIMUM_BACKOFF_SECONDS = 60 * 60;

export function retryDelaySeconds(attempt: number): number {
  const boundedAttempt = Math.max(1, Math.min(attempt, 12));
  return Math.min(2 ** boundedAttempt * 5, MAXIMUM_BACKOFF_SECONDS);
}
