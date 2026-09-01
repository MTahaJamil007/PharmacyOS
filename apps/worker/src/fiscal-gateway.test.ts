import type { Environment } from '@pharmacy/config';
import type { FiscalInvoice } from '@pharmacy/shared';
import { describe, expect, it, vi } from 'vitest';

import { FbrHttpGateway, serializeFiscalInvoice } from './fiscal-gateway.js';

const environment = {
  FBR_MODE: 'SANDBOX',
  FBR_API_BASE_URL: 'https://gw.fbr.gov.pk',
  FBR_API_TOKEN: 'sandbox-token-with-safe-length',
  FBR_REQUEST_TIMEOUT_MS: 2_000,
} as Environment;

const invoice: FiscalInvoice = {
  invoiceType: 'Sale Invoice',
  invoiceDate: '2026-09-01',
  sellerNTNCNIC: '1234567',
  sellerSTRN: '3277876123456',
  sellerPOSRegistrationNumber: 'POS-1',
  sellerBusinessName: 'PharmacyOS Pilot',
  sellerProvince: 'Punjab',
  sellerAddress: 'Lahore',
  buyerNTNCNIC: '',
  buyerBusinessName: 'Walk-in Customer',
  buyerProvince: 'Punjab',
  buyerAddress: 'Lahore',
  buyerRegistrationType: 'Unregistered',
  invoiceRefNo: '',
  scenarioId: 'SN001',
  items: [
    {
      hsCode: '3004.9000',
      productDescription: 'Medicine',
      rate: '18.00',
      uoM: 'Numbers, pieces, units',
      quantity: '1.000',
      totalValues: '1180.00',
      valueSalesExcludingST: '1000.00',
      fixedNotifiedValueOrRetailPrice: '0.00',
      salesTaxApplicable: '180.00',
      salesTaxWithheldAtSource: '0.00',
      extraTax: '0.00',
      furtherTax: '0.00',
      sroScheduleNo: '',
      fedPayable: '0.00',
      discount: '0.00',
      saleType: 'Goods at standard rate (default)',
      sroItemSerialNo: '',
    },
  ],
};

describe('FbrHttpGateway', () => {
  it('serializes exact decimals as JSON numbers without floating-point conversion', () => {
    const body = serializeFiscalInvoice(invoice);
    expect(body).toContain('"quantity":1.000');
    expect(body).toContain('"salesTaxApplicable":180.00');
    expect(body).toContain('"rate":"18%"');
  });

  it('uses the real sandbox validate and submit endpoints', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            invoiceNumber: '7000007DI1',
            validationResponse: { statusCode: '00', status: 'Valid', invoiceStatuses: [] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const gateway = new FbrHttpGateway(environment, fetchMock);

    expect((await gateway.validateInvoice(invoice)).ok).toBe(true);
    expect((await gateway.submitInvoice(invoice)).invoiceNumber).toBe('7000007DI1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb',
    );
    const requestHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(requestHeaders.get('authorization')).toBe('Bearer sandbox-token-with-safe-length');
  });

  it('marks a submit transport failure ambiguous instead of retrying a duplicate invoice', async () => {
    const gateway = new FbrHttpGateway(
      environment,
      vi.fn<typeof fetch>().mockRejectedValue(new Error('socket closed after write')),
    );
    const result = await gateway.submitInvoice(invoice);
    expect(result).toMatchObject({
      ok: false,
      ambiguousSubmission: true,
      retryable: false,
      errorCode: 'AMBIGUOUS_SUBMISSION',
    });
  });
});
