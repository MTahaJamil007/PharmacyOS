import { describe, expect, it } from 'vitest';

import { createPaymentInputs, paymentSummary } from './payment';

const form = {
  bankAmount: '',
  bankReference: '',
  cardAmount: '60.00',
  cardReference: 'AUTH-7',
  cashAmount: '40.00',
  cashTendered: '50.00',
  creditAmount: '',
};

describe('counter tender arithmetic', () => {
  it('computes exact split allocation and cash change', () => {
    expect(paymentSummary('100.00', form)).toEqual({
      allocated: '100.00',
      change: '10.00',
      complete: true,
      overAllocated: false,
      remaining: '0.00',
    });
    expect(createPaymentInputs('100.00', form)).toEqual([
      { amount: '40.00', method: 'CASH', tenderedAmount: '50.00' },
      { amount: '60.00', method: 'CARD', reference: 'AUTH-7' },
    ]);
  });

  it('supports exact customer-credit allocation', () => {
    const creditForm = {
      ...form,
      cardAmount: '',
      cashAmount: '25.00',
      cashTendered: '25.00',
      creditAmount: '75.00',
    };
    expect(paymentSummary('100.00', creditForm).complete).toBe(true);
    expect(createPaymentInputs('100.00', creditForm)).toEqual([
      { amount: '25.00', method: 'CASH', tenderedAmount: '25.00' },
      { amount: '75.00', method: 'CREDIT' },
    ]);
  });

  it('rejects under-allocation and cash short tendering', () => {
    expect(paymentSummary('100.00', { ...form, cardAmount: '59.99' }).complete).toBe(false);
    expect(paymentSummary('100.00', { ...form, cashTendered: '39.99' }).complete).toBe(false);
  });

  it('normalizes user-entered tender values at the API boundary', () => {
    expect(createPaymentInputs('100.00', { ...form, cashTendered: '50' })[0]).toEqual({
      amount: '40.00',
      method: 'CASH',
      tenderedAmount: '50.00',
    });
  });
});
