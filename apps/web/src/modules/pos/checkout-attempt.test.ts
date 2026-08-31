import { beforeEach, describe, expect, it } from 'vitest';

import type { CartLine } from '../../store';
import {
  createCheckoutAttempt,
  loadCheckoutAttempt,
  saveCheckoutAttempt,
} from './checkout-attempt';

const cart: readonly CartLine[] = [
  {
    medicine: {
      availableQuantity: '10.000',
      barcode: '8961100098765',
      daysToExpiry: 100,
      genericName: 'Paracetamol',
      id: '101',
      manufacturer: 'GSK',
      name: 'Panadol',
      nearestExpiry: '2027-01-01',
      salePrice: '35.00',
      shelf: 'A-01',
      strength: '500 mg',
    },
    quantity: 2,
  },
];

describe('persisted checkout attempt', () => {
  beforeEach(() => localStorage.clear());

  it('reuses one client request ID through draft, reservation, and retry', () => {
    const created = createCheckoutAttempt('terminal-1', cart);
    const reserved = {
      ...created,
      cashSessionId: '10',
      draftId: '20',
      reservedTotal: '70.00',
      reservedUntil: '2027-01-01T00:00:00.000Z',
    };
    saveCheckoutAttempt(reserved);

    expect(loadCheckoutAttempt('terminal-1', cart)).toEqual(reserved);
    expect(loadCheckoutAttempt('terminal-1', cart)?.clientRequestId).toBe(created.clientRequestId);
  });

  it('retains a finalized attempt even after the persisted cart was cleared', () => {
    const finalized = {
      ...createCheckoutAttempt('terminal-1', cart),
      finalizedSaleId: '30',
    };
    saveCheckoutAttempt(finalized);

    expect(loadCheckoutAttempt('terminal-1', [])).toEqual(finalized);
  });
});
