import type { DatabaseTransaction } from '@pharmacy/database';

const LOCK_KEY_SEPARATOR = '\u001f';

export async function lockIdempotencyKey(
  transaction: DatabaseTransaction,
  operation: string,
  branchId: string,
  clientRequestId: string,
): Promise<void> {
  const lockKey = [operation, branchId, clientRequestId].join(LOCK_KEY_SEPARATOR);
  await transaction`
    select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `;
}
