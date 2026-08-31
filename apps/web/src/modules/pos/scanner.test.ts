import { describe, expect, it } from 'vitest';

import { WedgeScannerBuffer } from './scanner';

describe('wedge scanner buffering', () => {
  it('accepts a fast Enter-terminated barcode', () => {
    const scanner = new WedgeScannerBuffer();
    let at = 1_000;
    for (const key of '8961100098765') {
      expect(scanner.push(key, at)).toBeNull();
      at += 12;
    }
    expect(scanner.push('Enter', at)).toBe('8961100098765');
  });

  it('does not misclassify ordinary typing as a scanner', () => {
    const scanner = new WedgeScannerBuffer();
    let at = 1_000;
    for (const key of 'panadol') {
      scanner.push(key, at);
      at += 90;
    }
    expect(scanner.push('Enter', at)).toBeNull();
  });
});
