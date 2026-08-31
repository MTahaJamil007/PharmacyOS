import { createClientRequestId } from '@pharmacy/shared';

import type { CartLine } from '../../store';

export interface CheckoutAttempt {
  readonly cartSignature: string;
  readonly cashSessionId?: string;
  readonly clientRequestId: string;
  readonly draftId?: string;
  readonly finalizedSaleId?: string;
  readonly reservedTotal?: string;
  readonly reservedUntil?: string;
  readonly terminalId: string;
}

function storageKey(terminalId: string): string {
  return `pharmacy-checkout-attempt-v1:${terminalId}`;
}

export function cartSignature(cart: readonly CartLine[]): string {
  return cart
    .map((line) => `${line.medicine.id}:${line.quantity}`)
    .sort()
    .join('|');
}

export function createCheckoutAttempt(
  terminalId: string,
  cart: readonly CartLine[],
): CheckoutAttempt {
  const attempt = {
    cartSignature: cartSignature(cart),
    clientRequestId: createClientRequestId(),
    terminalId,
  };
  saveCheckoutAttempt(attempt);
  return attempt;
}

export function loadCheckoutAttempt(
  terminalId: string,
  cart: readonly CartLine[],
): CheckoutAttempt | null {
  try {
    const raw = localStorage.getItem(storageKey(terminalId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CheckoutAttempt>;
    if (
      value.terminalId !== terminalId ||
      typeof value.clientRequestId !== 'string' ||
      typeof value.cartSignature !== 'string' ||
      (value.cartSignature !== cartSignature(cart) && typeof value.finalizedSaleId !== 'string')
    ) {
      clearCheckoutAttempt(terminalId);
      return null;
    }
    return value as CheckoutAttempt;
  } catch {
    clearCheckoutAttempt(terminalId);
    return null;
  }
}

export function saveCheckoutAttempt(attempt: CheckoutAttempt): void {
  localStorage.setItem(storageKey(attempt.terminalId), JSON.stringify(attempt));
}

export function clearCheckoutAttempt(terminalId: string): void {
  localStorage.removeItem(storageKey(terminalId));
}
