import { describe, expect, it, vi } from 'vitest';

import { createClientRequestId, type ClientRequestIdCrypto } from './client-request-id.js';

describe('createClientRequestId', () => {
  it('prefers the native randomUUID implementation', () => {
    const randomUUID = vi.fn(() => 'native-request-id');
    const getRandomValues = vi.fn();
    const provider: ClientRequestIdCrypto = {
      randomUUID,
      getRandomValues: <T extends ArrayBufferView>(value: T): T => {
        getRandomValues(value);
        return value;
      },
    };

    expect(createClientRequestId(provider)).toBe('native-request-id');
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('builds a standards-compliant UUID from getRandomValues on an HTTP LAN origin', () => {
    const provider: ClientRequestIdCrypto = {
      getRandomValues: <T extends ArrayBufferView>(target: T): T => {
        const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        return target;
      },
    };

    const requestId = createClientRequestId(provider);

    expect(requestId).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
