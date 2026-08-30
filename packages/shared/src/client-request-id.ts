export interface ClientRequestIdCrypto {
  readonly randomUUID?: () => string;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

function resolveCrypto(): ClientRequestIdCrypto {
  const provider = globalThis.crypto as ClientRequestIdCrypto | undefined;
  if (!provider || typeof provider.getRandomValues !== 'function') {
    throw new Error('A cryptographically secure random number generator is required');
  }
  return provider;
}

/**
 * Generates an RFC 4122 version 4 identifier without requiring a secure browser origin.
 * `crypto.randomUUID()` is secure-context-only in browsers, while `getRandomValues()` is
 * available on HTTP LAN origins and provides the entropy required for the fallback.
 */
export function createClientRequestId(provider = resolveCrypto()): string {
  if (typeof provider.randomUUID === 'function') {
    return provider.randomUUID.call(provider);
  }

  const bytes = provider.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hexadecimal = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'));
  return [
    hexadecimal.slice(0, 4).join(''),
    hexadecimal.slice(4, 6).join(''),
    hexadecimal.slice(6, 8).join(''),
    hexadecimal.slice(8, 10).join(''),
    hexadecimal.slice(10, 16).join(''),
  ].join('-');
}
