import { beforeEach, describe, expect, it, vi } from 'vitest';

import { previewMedicines } from './preview-data';
import { EMPTY_DISCOUNTS } from './modules/pos/discount';

const medicine = previewMedicines[0]!;
const key = 'pharmacy-counter-cart-v1';

async function loadStore() {
  vi.resetModules();
  return (await import('./store')).usePharmacyStore;
}

beforeEach(() => localStorage.clear());

describe('durable held bills', () => {
  it('keeps three independent bills and refuses a fourth without losing the current bill', async () => {
    const store = await loadStore();
    for (const quantity of [1, 2, 3]) {
      store.getState().addMedicine(medicine, quantity, '1+0+1');
      store
        .getState()
        .setDiscounts({ ...EMPTY_DISCOUNTS, invoice: { mode: 'PERCENT', value: '5' } });
      expect(store.getState().holdOrResumeCart()).toBe('HELD');
    }
    store.getState().addMedicine(medicine, 4);
    expect(store.getState().holdOrResumeCart()).toBe('FULL');
    expect(store.getState().cart[0]?.quantity).toBe(4);
    expect(store.getState().heldCarts.map((bill) => bill.lines[0]?.quantity)).toEqual([1, 2, 3]);
    const reloaded = await loadStore();
    expect(reloaded.getState().heldCarts).toEqual(store.getState().heldCarts);
    expect(reloaded.getState().cart[0]?.quantity).toBe(4);
    const selected = reloaded.getState().heldCarts[1]!;
    expect(reloaded.getState().resumeHeldCart(selected.id)).toBe(false);
    reloaded.getState().clearCart();
    expect(reloaded.getState().resumeHeldCart(selected.id)).toBe(true);
    expect(reloaded.getState().cart[0]).toMatchObject({ quantity: 2, dosage: '1+0+1' });
    expect(reloaded.getState().discounts).toEqual(selected.discounts);
    expect(reloaded.getState().heldCarts).toHaveLength(2);
    reloaded.getState().deleteHeldCart(reloaded.getState().heldCarts[0]!.id);
    expect((await loadStore()).getState().heldCarts).toHaveLength(1);
  });

  it('migrates a legacy bill without expiring it or losing discounts', async () => {
    const held = {
      heldAt: '2020-01-01T00:00:00Z',
      lines: [{ medicine, quantity: 2 }],
      discounts: EMPTY_DISCOUNTS,
    };
    localStorage.setItem(key, JSON.stringify({ cart: [], heldCart: held }));
    const store = await loadStore();
    expect(store.getState().heldCarts[0]).toMatchObject(held);
    expect(store.getState().holdOrResumeCart()).toBe('RESUMED');
    expect(store.getState().cart[0]?.quantity).toBe(2);
  });

  it('retains the current and held bills if storage fails', async () => {
    const store = await loadStore();
    store.getState().addMedicine(medicine, 2);
    const before = store.getState();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      expect(() => store.getState().holdOrResumeCart()).toThrow('quota');
      expect(store.getState()).toBe(before);
    } finally {
      write.mockRestore();
    }
  });
});
