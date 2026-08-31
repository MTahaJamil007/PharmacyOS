import { create } from 'zustand';

import type { LoginResponse, MedicineSearchResult } from './api';

const SESSION_KEY = 'pharmacy-session';
const CART_KEY = 'pharmacy-counter-cart-v1';

export interface CartLine {
  readonly medicine: MedicineSearchResult;
  readonly quantity: number;
}

export interface HeldCart {
  readonly heldAt: string;
  readonly lines: readonly CartLine[];
}

interface PersistedCartState {
  readonly cart: readonly CartLine[];
  readonly heldCart: HeldCart | null;
}

interface PharmacyState extends PersistedCartState {
  readonly session: LoginResponse | null;
  setSession: (session: LoginResponse | null) => void;
  addMedicine: (medicine: MedicineSearchResult, quantity?: number) => void;
  changeQuantity: (medicineId: string, delta: number) => void;
  setQuantity: (medicineId: string, quantity: number) => void;
  removeMedicine: (medicineId: string) => void;
  clearCart: () => void;
  holdOrResumeCart: () => 'HELD' | 'RESUMED' | 'UNCHANGED';
}

function readJson(key: string): unknown {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : (JSON.parse(value) as unknown);
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Partial<CartLine>;
  return (
    Number.isSafeInteger(line.quantity) &&
    Number(line.quantity) > 0 &&
    typeof line.medicine === 'object' &&
    line.medicine !== null &&
    typeof line.medicine.id === 'string' &&
    typeof line.medicine.name === 'string'
  );
}

function readCartState(): PersistedCartState {
  const value = readJson(CART_KEY);
  if (typeof value !== 'object' || value === null) return { cart: [], heldCart: null };
  const candidate = value as Partial<PersistedCartState>;
  const cart = Array.isArray(candidate.cart) ? candidate.cart.filter(isCartLine) : [];
  const heldCart =
    typeof candidate.heldCart === 'object' &&
    candidate.heldCart !== null &&
    typeof candidate.heldCart.heldAt === 'string' &&
    Array.isArray(candidate.heldCart.lines)
      ? {
          heldAt: candidate.heldCart.heldAt,
          lines: candidate.heldCart.lines.filter(isCartLine),
        }
      : null;
  return { cart, heldCart };
}

function persistCartState(state: PersistedCartState): void {
  localStorage.setItem(CART_KEY, JSON.stringify(state));
}

const storedSession = readJson(SESSION_KEY) as LoginResponse | null;
const storedCart = readCartState();

export const usePharmacyStore = create<PharmacyState>((set) => ({
  session: storedSession,
  ...storedCart,
  setSession: (session) => {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    set({ session });
  },
  addMedicine: (medicine, quantity = 1) =>
    set((state) => {
      const safeQuantity = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
      const existing = state.cart.find((line) => line.medicine.id === medicine.id);
      const cart = existing
        ? state.cart.map((line) =>
            line.medicine.id === medicine.id
              ? { ...line, quantity: line.quantity + safeQuantity }
              : line,
          )
        : [...state.cart, { medicine, quantity: safeQuantity }];
      persistCartState({ cart, heldCart: state.heldCart });
      return { cart };
    }),
  changeQuantity: (medicineId, delta) =>
    set((state) => {
      const cart = state.cart
        .map((line) =>
          line.medicine.id === medicineId
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line,
        )
        .filter((line) => line.quantity > 0);
      persistCartState({ cart, heldCart: state.heldCart });
      return { cart };
    }),
  setQuantity: (medicineId, quantity) =>
    set((state) => {
      if (!Number.isSafeInteger(quantity) || quantity < 1) return state;
      const cart = state.cart.map((line) =>
        line.medicine.id === medicineId ? { ...line, quantity } : line,
      );
      persistCartState({ cart, heldCart: state.heldCart });
      return { cart };
    }),
  removeMedicine: (medicineId) =>
    set((state) => {
      const cart = state.cart.filter((line) => line.medicine.id !== medicineId);
      persistCartState({ cart, heldCart: state.heldCart });
      return { cart };
    }),
  clearCart: () =>
    set((state) => {
      persistCartState({ cart: [], heldCart: state.heldCart });
      return { cart: [] };
    }),
  holdOrResumeCart: () => {
    let outcome: 'HELD' | 'RESUMED' | 'UNCHANGED' = 'UNCHANGED';
    set((state) => {
      if (state.cart.length > 0 && state.heldCart === null) {
        const heldCart = { heldAt: new Date().toISOString(), lines: state.cart };
        persistCartState({ cart: [], heldCart });
        outcome = 'HELD';
        return { cart: [], heldCart };
      }
      if (state.cart.length === 0 && state.heldCart?.lines.length) {
        const cart = state.heldCart.lines;
        persistCartState({ cart, heldCart: null });
        outcome = 'RESUMED';
        return { cart, heldCart: null };
      }
      return state;
    });
    return outcome;
  },
}));
