import { minorUnitsToMoney, moneyToMinorUnits, type SalePaymentInput } from '@pharmacy/shared';

export interface TenderForm {
  readonly bankAmount: string;
  readonly bankReference: string;
  readonly cardAmount: string;
  readonly cardReference: string;
  readonly cashAmount: string;
  readonly cashTendered: string;
  readonly creditAmount?: string;
}

function optionalMoney(value: string): bigint {
  return value.trim() === '' ? 0n : moneyToMinorUnits(value);
}

export function paymentSummary(total: string, form: TenderForm) {
  const totalMinor = moneyToMinorUnits(total);
  const cash = optionalMoney(form.cashAmount);
  const card = optionalMoney(form.cardAmount);
  const bank = optionalMoney(form.bankAmount);
  const credit = optionalMoney(form.creditAmount ?? '');
  const allocated = cash + card + bank + credit;
  const tendered = form.cashTendered.trim() === '' ? cash : moneyToMinorUnits(form.cashTendered);
  return {
    allocated: minorUnitsToMoney(allocated),
    change: minorUnitsToMoney(tendered > cash ? tendered - cash : 0n),
    complete: allocated === totalMinor && tendered >= cash && allocated > 0n,
    remaining: minorUnitsToMoney(totalMinor > allocated ? totalMinor - allocated : 0n),
    overAllocated: allocated > totalMinor,
  };
}

export function createPaymentInputs(total: string, form: TenderForm): readonly SalePaymentInput[] {
  const summary = paymentSummary(total, form);
  if (!summary.complete) throw new Error('Payment allocation must equal the sale total');
  const payments: SalePaymentInput[] = [];
  const cash = optionalMoney(form.cashAmount);
  const card = optionalMoney(form.cardAmount);
  const bank = optionalMoney(form.bankAmount);
  const credit = optionalMoney(form.creditAmount ?? '');
  if (cash > 0n) {
    const tendered = form.cashTendered.trim() === '' ? cash : moneyToMinorUnits(form.cashTendered);
    payments.push({
      amount: minorUnitsToMoney(cash),
      method: 'CASH',
      tenderedAmount: minorUnitsToMoney(tendered),
    });
  }
  if (card > 0n) {
    payments.push({
      amount: minorUnitsToMoney(card),
      method: 'CARD',
      ...(form.cardReference.trim() ? { reference: form.cardReference.trim() } : {}),
    });
  }
  if (bank > 0n) {
    payments.push({
      amount: minorUnitsToMoney(bank),
      method: 'BANK_TRANSFER',
      ...(form.bankReference.trim() ? { reference: form.bankReference.trim() } : {}),
    });
  }
  if (credit > 0n) {
    payments.push({ amount: minorUnitsToMoney(credit), method: 'CREDIT' });
  }
  return payments;
}
