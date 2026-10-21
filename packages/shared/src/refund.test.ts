import { describe, expect, it } from 'vitest';

import { cumulativeRefundAmount, netPaidPerSaleLine } from './refund.js';
import { sumMoney } from './money.js';

describe('netPaidPerSaleLine', () => {
  it('removes the invoice discount from the lines in proportion to their value', () => {
    expect(netPaidPerSaleLine(['600.00', '400.00'], '100.00')).toEqual(['540.00', '360.00']);
  });

  it('always reconciles to the amount the customer paid', () => {
    const lines = ['33.33', '33.33', '33.34'];
    const net = netPaidPerSaleLine(lines, '10.01');
    expect(sumMoney(net)).toBe('89.99');
  });

  it('is the identity when there is no invoice discount', () => {
    expect(netPaidPerSaleLine(['10.00', '5.50'], '0.00')).toEqual(['10.00', '5.50']);
  });
});

describe('cumulativeRefundAmount', () => {
  it('refunds the full net amount when the whole line comes back at once', () => {
    expect(
      cumulativeRefundAmount({
        netPaid: '540.00',
        previouslyRefunded: '0.00',
        previouslyReturnedQuantity: '0',
        quantity: '6',
        soldQuantity: '6',
      }),
    ).toBe('540.00');
  });

  it('never refunds more than the line in total across partial returns', () => {
    let refunded = '0.00';
    let returned = 0;
    const parts: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const part = cumulativeRefundAmount({
        netPaid: '10.01',
        previouslyRefunded: refunded,
        previouslyReturnedQuantity: String(returned),
        quantity: '1',
        soldQuantity: '3',
      });
      parts.push(part);
      refunded = sumMoney([refunded, part]);
      returned += 1;
    }
    expect(parts).toEqual(['3.34', '3.33', '3.34']);
    expect(refunded).toBe('10.01');
  });

  it('handles fractional base-unit quantities exactly', () => {
    expect(
      cumulativeRefundAmount({
        netPaid: '100.00',
        previouslyRefunded: '0.00',
        previouslyReturnedQuantity: '0',
        quantity: '0.5',
        soldQuantity: '2',
      }),
    ).toBe('25.00');
  });

  it('rejects a quantity beyond what remains of the line', () => {
    expect(() =>
      cumulativeRefundAmount({
        netPaid: '100.00',
        previouslyRefunded: '50.00',
        previouslyReturnedQuantity: '1',
        quantity: '2',
        soldQuantity: '2',
      }),
    ).toThrow('exceeds remaining');
  });
});
