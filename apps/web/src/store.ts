import { create } from 'zustand';

import type { LoginResponse, MedicineSearchResult } from './api';

export interface CartLine {
  readonly medicine: MedicineSearchResult;
  readonly quantity: number;
}

interface PharmacyState {
  readonly session: LoginResponse | null;
  readonly cart: readonly CartLine[];
  setSession: (session: LoginResponse | null) => void;
  addMedicine: (medicine: MedicineSearchResult) => void;
  changeQuantity: (medicineId: string, delta: number) => void;
  clearCart: () => void;
}

const storedSession = localStorage.getItem('pharmacy-session');

export const usePharmacyStore = create<PharmacyState>((set) => ({
  session: storedSession ? (JSON.parse(storedSession) as LoginResponse) : null,
  cart: [],
  setSession: (session) => {
    if (session) localStorage.setItem('pharmacy-session', JSON.stringify(session));
    else localStorage.removeItem('pharmacy-session');
    set({ session, cart: [] });
  },
  addMedicine: (medicine) =>
    set((state) => {
      const existing = state.cart.find((line) => line.medicine.id === medicine.id);
      if (existing) {
        return {
          cart: state.cart.map((line) =>
            line.medicine.id === medicine.id ? { ...line, quantity: line.quantity + 1 } : line,
          ),
        };
      }
      return { cart: [...state.cart, { medicine, quantity: 1 }] };
    }),
  changeQuantity: (medicineId, delta) =>
    set((state) => ({
      cart: state.cart
        .map((line) =>
          line.medicine.id === medicineId
            ? { ...line, quantity: Math.max(0, line.quantity + delta) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    })),
  clearCart: () => set({ cart: [] }),
}));
