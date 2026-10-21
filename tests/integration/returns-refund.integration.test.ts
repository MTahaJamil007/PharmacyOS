import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIntegrationApi, type IntegrationApi } from './harness/api.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';
import {
  createBranchFixture,
  createStockedMedicine,
  jsonBody,
  openCashSession,
  sellAtCounter,
  type BranchFixture,
} from './harness/fixtures.js';

interface LookupBody {
  readonly sale: { readonly lookupToken: string; readonly invoiceNumber: string };
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly netPaid: string;
    readonly eligibleQuantity: string;
  }>;
}

describe('returns and refunds', () => {
  let api: IntegrationApi;
  let database: IsolatedDatabase;
  let fixture: BranchFixture;
  let cashSessionId: string;
  let tablets: { medicineId: string; batchId: string };
  let syrup: { medicineId: string; batchId: string };

  beforeAll(async () => {
    database = await createIsolatedDatabase('returns_refund');
    fixture = await createBranchFixture(database, 'refunds');
    tablets = await createStockedMedicine(database, fixture.branchId, {
      name: 'Refund Tablets',
      quantity: '100',
      salePrice: '20.00',
    });
    syrup = await createStockedMedicine(database, fixture.branchId, {
      name: 'Refund Syrup',
      quantity: '20',
      salePrice: '150.00',
    });
    api = await createIntegrationApi(database.applicationUrl);
    cashSessionId = await openCashSession(api, fixture, 'refund-open-session');
  });

  afterAll(async () => {
    if (api) await api.close();
    if (database) await database.dispose();
  });

  async function lookupInvoice(invoiceNumber: string): Promise<LookupBody> {
    const response = await api.app.inject({
      headers: fixture.headers,
      method: 'GET',
      url: `/api/v1/returns/invoices/${invoiceNumber}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    return jsonBody<LookupBody>(response);
  }

  async function requestReturn(
    token: string,
    requestId: string,
    items: ReadonlyArray<{ saleItemId: string; quantity: string; disposition?: string }>,
  ) {
    return api.app.inject({
      headers: fixture.headers,
      method: 'POST',
      payload: {
        clientRequestId: requestId,
        items: items.map((item) => ({ disposition: 'RESTOCK_SELLABLE', ...item })),
        reason: 'Customer changed prescription',
      },
      url: `/api/v1/returns/lookup/${token}/request`,
    });
  }

  async function approveAndRefund(returnId: string, payload: Record<string, unknown>) {
    const approve = await api.app.inject({
      headers: fixture.headers,
      method: 'POST',
      url: `/api/v1/returns/${returnId}/approve`,
    });
    expect(approve.statusCode, approve.body).toBe(201);
    return api.app.inject({
      headers: fixture.headers,
      method: 'POST',
      payload,
      url: `/api/v1/returns/${returnId}/refund`,
    });
  }

  it('refunds what the customer paid after the invoice discount, not the shelf price', async () => {
    // 3 x 20.00 + 1 x 150.00 = 210.00, less a 21.00 invoice discount = 189.00 paid.
    const sale = await sellAtCounter(api, fixture, cashSessionId, {
      invoiceDiscount: '21.00',
      items: [
        { medicineId: tablets.medicineId, quantity: '3' },
        { medicineId: syrup.medicineId, quantity: '1' },
      ],
      requestId: 'refund-discounted-sale',
    });
    expect(sale.total).toBe('189.00');
    const lookup = await lookupInvoice(String(sale.invoiceNumber));
    expect(lookup.items.map((item) => item.netPaid).sort()).toEqual(['135.00', '54.00']);

    const request = await requestReturn(
      lookup.sale.lookupToken,
      'refund-discounted-return',
      lookup.items.map((item) => ({ quantity: item.eligibleQuantity, saleItemId: item.id })),
    );
    expect(request.statusCode, request.body).toBe(201);
    expect(jsonBody(request)).toMatchObject({ refundAmount: '189.00', status: 'REQUESTED' });

    const refund = await approveAndRefund(String(jsonBody(request).id), {
      cashSessionId,
      method: 'CASH',
    });
    expect(refund.statusCode, refund.body).toBe(201);
    expect(jsonBody(refund)).toMatchObject({ refundAmount: '189.00', status: 'REFUNDED' });

    const [stock] = await database.admin<{ current_qty: string }[]>`
      select current_qty::text from inventory_batches where id = ${syrup.batchId}
    `;
    expect(stock?.current_qty).toBe('20.000');
  });

  it('never refunds more than the line in total when it comes back in parts', async () => {
    // 3 x 20.00 = 60.00, less 0.01 discount: 59.99 across three units.
    const sale = await sellAtCounter(api, fixture, cashSessionId, {
      invoiceDiscount: '0.01',
      items: [{ medicineId: tablets.medicineId, quantity: '3' }],
      requestId: 'refund-partial-sale',
    });
    const lookup = await lookupInvoice(String(sale.invoiceNumber));
    const line = lookup.items[0];
    if (!line) throw new Error('Expected one sale line');
    const parts: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const request = await requestReturn(lookup.sale.lookupToken, `refund-partial-${index}`, [
        { quantity: '1', saleItemId: line.id },
      ]);
      expect(request.statusCode, request.body).toBe(201);
      parts.push(String(jsonBody(request).refundAmount));
    }
    expect(parts).toEqual(['20.00', '19.99', '20.00']);

    const fourth = await requestReturn(lookup.sale.lookupToken, 'refund-partial-3', [
      { quantity: '1', saleItemId: line.id },
    ]);
    expect(fourth.statusCode).toBe(409);
  });

  it('releases the quantity of a rejected request so a corrected one can be made', async () => {
    const sale = await sellAtCounter(api, fixture, cashSessionId, {
      items: [{ medicineId: tablets.medicineId, quantity: '2' }],
      requestId: 'refund-reject-sale',
    });
    const lookup = await lookupInvoice(String(sale.invoiceNumber));
    const line = lookup.items[0];
    if (!line) throw new Error('Expected one sale line');
    const first = await requestReturn(lookup.sale.lookupToken, 'refund-reject-1', [
      { quantity: '2', saleItemId: line.id },
    ]);
    const rejected = await api.app.inject({
      headers: fixture.headers,
      method: 'POST',
      payload: { reason: 'Seal broken; not returnable' },
      url: `/api/v1/returns/${String(jsonBody(first).id)}/reject`,
    });
    expect(rejected.statusCode, rejected.body).toBe(201);
    expect((await lookupInvoice(String(sale.invoiceNumber))).items[0]?.eligibleQuantity).toBe(
      '2.000',
    );

    const queue = await api.app.inject({
      headers: fixture.headers,
      method: 'GET',
      url: '/api/v1/returns?status=REJECTED',
    });
    expect(jsonBody<{ data: unknown[] }>(queue).data).toEqual([
      expect.objectContaining({
        rejectionReason: 'Seal broken; not returnable',
        status: 'REJECTED',
      }),
    ]);
  });

  it('keeps outstanding customer credit on the account instead of paying it out as cash', async () => {
    const customer = await api.app.inject({
      headers: fixture.headers,
      method: 'POST',
      payload: { creditLimit: '5000.00', name: 'Khata Customer', phone: '03001234567' },
      url: '/api/v1/customers',
    });
    expect(customer.statusCode, customer.body).toBe(201);
    const customerId = String(jsonBody(customer).id);
    const sale = await sellAtCounter(api, fixture, cashSessionId, {
      customerId,
      items: [{ medicineId: syrup.medicineId, quantity: '2' }],
      payments: [{ amount: '300.00', method: 'CREDIT' }],
      requestId: 'refund-credit-sale',
    });
    const lookup = await lookupInvoice(String(sale.invoiceNumber));
    const line = lookup.items[0];
    if (!line) throw new Error('Expected one sale line');

    const firstRequest = await requestReturn(lookup.sale.lookupToken, 'refund-credit-1', [
      { quantity: '1', saleItemId: line.id },
    ]);
    const cash = await approveAndRefund(String(jsonBody(firstRequest).id), {
      cashSessionId,
      method: 'CASH',
    });
    expect(cash.statusCode).toBe(409);
    expect(cash.body).toContain('still owed on the customer account');

    const account = await api.app.inject({
      headers: fixture.headers,
      method: 'POST',
      payload: { method: 'CUSTOMER_ACCOUNT' },
      url: `/api/v1/returns/${String(jsonBody(firstRequest).id)}/refund`,
    });
    expect(account.statusCode, account.body).toBe(201);
    const statement = await api.app.inject({
      headers: fixture.headers,
      method: 'GET',
      url: `/api/v1/customers/${customerId}/statement`,
    });
    const statementBody = jsonBody<{
      customer: { balance: string };
      entries: Array<{ entryType: string; amountDelta: string }>;
    }>(statement);
    expect(statementBody.customer.balance).toBe('150.00');
    expect(statementBody.entries[0]).toMatchObject({
      amountDelta: '-150.00',
      entryType: 'RETURN_CREDIT',
    });

    // Once the customer has settled the account in cash, the remaining return may be paid out.
    const payment = await api.app.inject({
      headers: fixture.headers,
      method: 'POST',
      payload: {
        amount: '150.00',
        cashSessionId,
        clientRequestId: 'refund-credit-settle',
        method: 'CASH',
      },
      url: `/api/v1/customers/${customerId}/payments`,
    });
    expect(payment.statusCode, payment.body).toBe(201);
    const secondRequest = await requestReturn(lookup.sale.lookupToken, 'refund-credit-2', [
      { quantity: '1', saleItemId: line.id },
    ]);
    const cashAfterSettlement = await approveAndRefund(String(jsonBody(secondRequest).id), {
      cashSessionId,
      method: 'CASH',
    });
    expect(cashAfterSettlement.statusCode, cashAfterSettlement.body).toBe(201);
    expect(jsonBody(cashAfterSettlement)).toMatchObject({ refundAmount: '150.00' });
  });

  it('refuses to restock expired stock as sellable when the return is requested', async () => {
    const expiring = await createStockedMedicine(database, fixture.branchId, {
      expiryDays: 1,
      name: 'Refund Expiring',
      quantity: '5',
      salePrice: '10.00',
    });
    const sale = await sellAtCounter(api, fixture, cashSessionId, {
      items: [{ medicineId: expiring.medicineId, quantity: '1' }],
      requestId: 'refund-expired-sale',
    });
    await database.admin`
      update inventory_batches set expiry_date = current_date - 1 where id = ${expiring.batchId}
    `;
    const lookup = await lookupInvoice(String(sale.invoiceNumber));
    const line = lookup.items[0];
    if (!line) throw new Error('Expected one sale line');
    const sellable = await requestReturn(lookup.sale.lookupToken, 'refund-expired-1', [
      { quantity: '1', saleItemId: line.id },
    ]);
    expect(sellable.statusCode).toBe(409);
    const quarantined = await requestReturn(lookup.sale.lookupToken, 'refund-expired-2', [
      { disposition: 'QUARANTINE', quantity: '1', saleItemId: line.id },
    ]);
    expect(quarantined.statusCode, quarantined.body).toBe(201);
  });
});
