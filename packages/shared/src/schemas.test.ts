import { describe, expect, it } from 'vitest';

import {
  createDraftSchema,
  finalizeSaleSchema,
  idSchema,
  moneySchema,
  positiveQuantitySchema,
  quantitySchema,
  supplierQuoteSchema,
} from './schemas.js';

describe('shared request magnitude boundaries', () => {
  it('matches PostgreSQL bigint, numeric quantity, and money ceilings exactly', () => {
    expect(idSchema.safeParse('9223372036854775807').success).toBe(true);
    expect(idSchema.safeParse('9223372036854775808').success).toBe(false);
    expect(quantitySchema.safeParse('999999999.999').success).toBe(true);
    expect(quantitySchema.safeParse('1000000000').success).toBe(false);
    expect(moneySchema.safeParse('9999999999.99').success).toBe(true);
    expect(moneySchema.safeParse('10000000000.00').success).toBe(false);
  });

  it('rejects zero wherever the database use case requires a positive value', () => {
    expect(positiveQuantitySchema.safeParse('0.000').success).toBe(false);
    expect(
      createDraftSchema.safeParse({
        items: [{ medicineId: '1', quantity: '0' }],
        terminalId: '1',
      }).success,
    ).toBe(false);
    expect(
      finalizeSaleSchema.safeParse({
        cashSessionId: '1',
        clientRequestId: 'request-0001',
        draftId: '1',
        payments: [{ amount: '0', method: 'CASH' }],
      }).success,
    ).toBe(false);
  });

  it('rejects inverted supplier quote date ranges', () => {
    expect(
      supplierQuoteSchema.safeParse({
        baseUnitsPerQuoteUnit: '10',
        medicineId: '1',
        minimumOrderQuantity: '0',
        quotedUnitCost: '100.00',
        quoteUnit: 'pack',
        source: 'supplier invoice',
        supplierId: '1',
        validFrom: '2026-09-02',
        validUntil: '2026-09-01',
      }).success,
    ).toBe(false);
  });
});
