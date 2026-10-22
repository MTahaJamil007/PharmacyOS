import { normalizeDosage } from '@pharmacy/shared';
import { create } from 'zustand';

import type { LoginResponse, MedicineSearchResult } from './api';
import { rememberDeviceTerminalCode } from './deviceTerminal';
import {
  EMPTY_DISCOUNTS,
  isDiscountSpec,
  type CartDiscounts,
  type DiscountSpec,
} from './modules/pos/discount';

const SESSION_KEY = 'pharmacy-session';
const CART_KEY = 'pharmacy-counter-cart-v1';

export interface CartLine {
  readonly medicine: MedicineSearchResult;
  readonly quantity: number;
  /** Optional canonical patient timing such as "1+0+1 after meal". */
  readonly dosage?: string;
}

export interface HeldCart {
  readonly heldAt: string;
  readonly lines: readonly CartLine[];
  readonly discounts: CartDiscounts;
}

interface PersistedCartState {
  readonly cart: readonly CartLine[];
  readonly discounts: CartDiscounts;
  readonly heldCart: HeldCart | null;
}

interface PharmacyState extends PersistedCartState {
  readonly session: LoginResponse | null;
  setSession: (session: LoginResponse | null) => void;
  addMedicine: (medicine: MedicineSearchResult, quantity?: number, dosage?: string | null) => void;
  changeQuantity: (medicineId: string, delta: number) => void;
  setQuantity: (medicineId: string, quantity: number) => void;
  setDosage: (medicineIds: readonly string[], dosage: string | null) => void;
  applyQuantities: (quantities: Readonly<Record<string, number>>) => void;
  removeMedicine: (medicineId: string) => void;
  removeMedicines: (medicineIds: readonly string[]) => void;
  setDiscounts: (discounts: CartDiscounts) => void;
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
    typeof line.medicine.name === 'string' &&
    (line.dosage === undefined ||
      (typeof line.dosage === 'string' && normalizeDosage(line.dosage) === line.dosage))
  );
}

function withDosage(line: CartLine, dosage: string | null): CartLine {
  if (dosage) return { ...line, dosage };
  return { medicine: line.medicine, quantity: line.quantity };
}

/** Drops anything malformed and any line discount whose medicine is no longer on the ticket. */
function readDiscounts(value: unknown, lines: readonly CartLine[]): CartDiscounts {
  if (typeof value !== 'object' || value === null) return EMPTY_DISCOUNTS;
  const candidate = value as Partial<CartDiscounts>;
  const ids = new Set(lines.map((line) => line.medicine.id));
  const lineEntries: Array<[string, DiscountSpec]> = [];
  if (typeof candidate.lines === 'object' && candidate.lines !== null) {
    for (const [medicineId, spec] of Object.entries(candidate.lines)) {
      if (ids.has(medicineId) && isDiscountSpec(spec)) lineEntries.push([medicineId, spec]);
    }
  }
  return {
    lines: Object.fromEntries(lineEntries),
    invoice: isDiscountSpec(candidate.invoice) ? candidate.invoice : null,
    reason: typeof candidate.reason === 'string' ? candidate.reason.slice(0, 500) : '',
  };
}

function withoutLineDiscounts(
  discounts: CartDiscounts,
  medicineIds: readonly string[],
): CartDiscounts {
  const removed = new Set(medicineIds);
  return {
    ...discounts,
    lines: Object.fromEntries(
      Object.entries(discounts.lines).filter(([medicineId]) => !removed.has(medicineId)),
    ),
  };
}

function readCartState(): PersistedCartState {
  const value = readJson(CART_KEY);
  if (typeof value !== 'object' || value === null) {
    return { cart: [], discounts: EMPTY_DISCOUNTS, heldCart: null };
  }
  const candidate = value as Partial<PersistedCartState>;
  const cart = Array.isArray(candidate.cart) ? candidate.cart.filter(isCartLine) : [];
  let heldCart: HeldCart | null = null;
  if (
    typeof candidate.heldCart === 'object' &&
    candidate.heldCart !== null &&
    typeof candidate.heldCart.heldAt === 'string' &&
    Array.isArray(candidate.heldCart.lines)
  ) {
    const lines = candidate.heldCart.lines.filter(isCartLine);
    heldCart = {
      heldAt: candidate.heldCart.heldAt,
      lines,
      discounts: readDiscounts(candidate.heldCart.discounts, lines),
    };
  }
  return { cart, discounts: readDiscounts(candidate.discounts, cart), heldCart };
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
    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      rememberDeviceTerminalCode(session.user.terminalCode);
    } else localStorage.removeItem(SESSION_KEY);
    set({ session });
  },
  addMedicine: (medicine, quantity = 1, dosage) =>
    set((state) => {
      if (!Number.isSafeInteger(quantity) || quantity < 1) return state;
      const existing = state.cart.find((line) => line.medicine.id === medicine.id);
      // An explicit timing replaces the line's; adding more without one keeps what is there.
      const cart = existing
        ? state.cart.map((line) => {
            if (line.medicine.id !== medicine.id) return line;
            const next = { ...line, quantity: line.quantity + quantity };
            return dosage === undefined ? next : withDosage(next, dosage);
          })
        : [...state.cart, withDosage({ medicine, quantity }, dosage ?? null)];
      persistCartState({ cart, discounts: state.discounts, heldCart: state.heldCart });
      return { cart };
    }),
  setDosage: (medicineIds, dosage) =>
    set((state) => {
      const targets = new Set(medicineIds);
      const cart = state.cart.map((line) =>
        targets.has(line.medicine.id) ? withDosage(line, dosage) : line,
      );
      persistCartState({ cart, discounts: state.discounts, heldCart: state.heldCart });
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
      const discounts = cart.some((line) => line.medicine.id === medicineId)
        ? state.discounts
        : withoutLineDiscounts(state.discounts, [medicineId]);
      persistCartState({ cart, discounts, heldCart: state.heldCart });
      return { cart, discounts };
    }),
  setQuantity: (medicineId, quantity) =>
    set((state) => {
      if (!Number.isSafeInteger(quantity) || quantity < 1) return state;
      const cart = state.cart.map((line) =>
        line.medicine.id === medicineId ? { ...line, quantity } : line,
      );
      persistCartState({ cart, discounts: state.discounts, heldCart: state.heldCart });
      return { cart };
    }),
  applyQuantities: (quantities) =>
    set((state) => {
      const valid = Object.values(quantities).every(
        (quantity) => Number.isSafeInteger(quantity) && quantity >= 1,
      );
      if (!valid) return state;
      const cart = state.cart.map((line) => {
        const quantity = quantities[line.medicine.id];
        return quantity === undefined ? line : { ...line, quantity };
      });
      persistCartState({ cart, discounts: state.discounts, heldCart: state.heldCart });
      return { cart };
    }),
  removeMedicine: (medicineId) =>
    set((state) => {
      const cart = state.cart.filter((line) => line.medicine.id !== medicineId);
      const discounts = withoutLineDiscounts(state.discounts, [medicineId]);
      persistCartState({ cart, discounts, heldCart: state.heldCart });
      return { cart, discounts };
    }),
  removeMedicines: (medicineIds) =>
    set((state) => {
      const removed = new Set(medicineIds);
      const cart = state.cart.filter((line) => !removed.has(line.medicine.id));
      const discounts = withoutLineDiscounts(state.discounts, medicineIds);
      persistCartState({ cart, discounts, heldCart: state.heldCart });
      return { cart, discounts };
    }),
  setDiscounts: (next) =>
    set((state) => {
      const discounts = readDiscounts(next, state.cart);
      persistCartState({ cart: state.cart, discounts, heldCart: state.heldCart });
      return { discounts };
    }),
  clearCart: () =>
    set((state) => {
      persistCartState({ cart: [], discounts: EMPTY_DISCOUNTS, heldCart: state.heldCart });
      return { cart: [], discounts: EMPTY_DISCOUNTS };
    }),
  holdOrResumeCart: () => {
    let outcome: 'HELD' | 'RESUMED' | 'UNCHANGED' = 'UNCHANGED';
    set((state) => {
      if (state.cart.length > 0 && state.heldCart === null) {
        const heldCart = {
          heldAt: new Date().toISOString(),
          lines: state.cart,
          discounts: state.discounts,
        };
        persistCartState({ cart: [], discounts: EMPTY_DISCOUNTS, heldCart });
        outcome = 'HELD';
        return { cart: [], discounts: EMPTY_DISCOUNTS, heldCart };
      }
      if (state.cart.length === 0 && state.heldCart?.lines.length) {
        const cart = state.heldCart.lines;
        const discounts = state.heldCart.discounts;
        persistCartState({ cart, discounts, heldCart: null });
        outcome = 'RESUMED';
        return { cart, discounts, heldCart: null };
      }
      return state;
    });
    return outcome;
  },
}));
