export async function runConcurrently<T>(
  clientCount: number,
  operation: (clientIndex: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  if (!Number.isSafeInteger(clientCount) || clientCount < 1 || clientCount > 100) {
    throw new RangeError('clientCount must be an integer from 1 through 100');
  }

  let release: (() => void) | undefined;
  const startingGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const clients = Array.from({ length: clientCount }, async (_, clientIndex) => {
    await startingGate;
    return operation(clientIndex);
  });

  release?.();
  return Promise.allSettled(clients);
}
