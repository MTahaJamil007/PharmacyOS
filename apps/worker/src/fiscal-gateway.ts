import { randomUUID } from 'node:crypto';

import type { Environment } from '@pharmacy/config';
import type {
  FiscalGatewayResult,
  FiscalInvoice,
  FiscalInvoiceGateway,
  FiscalInvoiceItem,
  FiscalReferenceDataKind,
} from '@pharmacy/shared';

type FetchImplementation = typeof fetch;

const REFERENCE_PATHS: Record<FiscalReferenceDataKind, string> = {
  provinces: '/pdi/v1/provinces',
  'document-types': '/pdi/v1/doctypecode',
  items: '/pdi/v1/itemdesccode',
  'transaction-types': '/pdi/v1/transtypecode',
  'units-of-measure': '/pdi/v1/uom',
};

const decimalPattern = /^\d+(?:\.\d+)?$/;

function rawDecimal(value: string, maximumScale: number): string {
  if (!decimalPattern.test(value)) throw new Error(`Invalid fiscal decimal: ${value}`);
  const fraction = value.split('.')[1] ?? '';
  if (fraction.length > maximumScale) {
    throw new Error(`Fiscal decimal exceeds scale ${maximumScale}: ${value}`);
  }
  return value;
}

function jsonString(value: string | null): string {
  return JSON.stringify(value ?? '');
}

function serializeItem(item: FiscalInvoiceItem): string {
  return `{"hsCode":${jsonString(item.hsCode)},"productDescription":${jsonString(item.productDescription)},"rate":${jsonString(`${item.rate.replace(/\.00$/, '')}%`)},"uoM":${jsonString(item.uoM)},"quantity":${rawDecimal(item.quantity, 4)},"totalValues":${rawDecimal(item.totalValues, 2)},"valueSalesExcludingST":${rawDecimal(item.valueSalesExcludingST, 2)},"fixedNotifiedValueOrRetailPrice":${rawDecimal(item.fixedNotifiedValueOrRetailPrice, 2)},"salesTaxApplicable":${rawDecimal(item.salesTaxApplicable, 2)},"salesTaxWithheldAtSource":${rawDecimal(item.salesTaxWithheldAtSource, 2)},"extraTax":${rawDecimal(item.extraTax, 2)},"furtherTax":${rawDecimal(item.furtherTax, 2)},"sroScheduleNo":${jsonString(item.sroScheduleNo)},"fedPayable":${rawDecimal(item.fedPayable, 2)},"discount":${rawDecimal(item.discount, 2)},"saleType":${jsonString(item.saleType)},"sroItemSerialNo":${jsonString(item.sroItemSerialNo)}}`;
}

export function serializeFiscalInvoice(invoice: FiscalInvoice): string {
  const scenario = invoice.scenarioId ? `,"scenarioId":${jsonString(invoice.scenarioId)}` : '';
  return `{"invoiceType":${jsonString(invoice.invoiceType)},"invoiceDate":${jsonString(invoice.invoiceDate)},"sellerNTNCNIC":${jsonString(invoice.sellerNTNCNIC)},"sellerBusinessName":${jsonString(invoice.sellerBusinessName)},"sellerProvince":${jsonString(invoice.sellerProvince)},"sellerAddress":${jsonString(invoice.sellerAddress)},"buyerNTNCNIC":${jsonString(invoice.buyerNTNCNIC)},"buyerBusinessName":${jsonString(invoice.buyerBusinessName)},"buyerProvince":${jsonString(invoice.buyerProvince)},"buyerAddress":${jsonString(invoice.buyerAddress)},"buyerRegistrationType":${jsonString(invoice.buyerRegistrationType)},"invoiceRefNo":${jsonString(invoice.invoiceRefNo)}${scenario},"items":[${invoice.items.map(serializeItem).join(',')}]}`;
}

function responseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function validationDetails(response: Record<string, unknown> | null): {
  readonly valid: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
} {
  const validation = responseRecord(response?.validationResponse);
  const itemStatuses = Array.isArray(validation?.invoiceStatuses)
    ? validation.invoiceStatuses.map(responseRecord).filter((item) => item !== null)
    : [];
  const valid =
    textValue(validation?.status)?.toLocaleLowerCase('en-US') === 'valid' &&
    itemStatuses.every((item) => textValue(item.status)?.toLocaleLowerCase('en-US') === 'valid');
  const failedItem = itemStatuses.find(
    (item) => textValue(item.status)?.toLocaleLowerCase('en-US') !== 'valid',
  );
  return {
    valid,
    errorCode: textValue(validation?.errorCode) ?? textValue(failedItem?.errorCode),
    errorMessage:
      textValue(validation?.error) ??
      textValue(failedItem?.error) ??
      (valid ? null : 'Invalid FBR response'),
  };
}

export class FbrHttpGateway implements FiscalInvoiceGateway {
  private readonly baseUrl: string;

  constructor(
    private readonly environment: Environment,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {
    this.baseUrl = environment.FBR_API_BASE_URL.replace(/\/+$/, '');
  }

  validateInvoice(invoice: FiscalInvoice): Promise<FiscalGatewayResult> {
    return this.invoiceRequest('VALIDATE', invoice);
  }

  submitInvoice(invoice: FiscalInvoice): Promise<FiscalGatewayResult> {
    return this.invoiceRequest('SUBMIT', invoice);
  }

  getReferenceData(kind: FiscalReferenceDataKind): Promise<FiscalGatewayResult> {
    return this.request('REFERENCE_DATA', `${this.baseUrl}${REFERENCE_PATHS[kind]}`, undefined);
  }

  private invoiceRequest(
    operation: 'VALIDATE' | 'SUBMIT',
    invoice: FiscalInvoice,
  ): Promise<FiscalGatewayResult> {
    const sandboxSuffix = this.environment.FBR_MODE === 'SANDBOX' ? '_sb' : '';
    const method = operation === 'VALIDATE' ? 'validateinvoicedata' : 'postinvoicedata';
    return this.request(
      operation,
      `${this.baseUrl}/di_data/v1/di/${method}${sandboxSuffix}`,
      serializeFiscalInvoice(invoice),
    );
  }

  private async request(
    operation: 'VALIDATE' | 'SUBMIT' | 'REFERENCE_DATA',
    url: string,
    body: string | undefined,
  ): Promise<FiscalGatewayResult> {
    const started = Date.now();
    const correlationId = randomUUID();
    try {
      const response = await this.fetchImplementation(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.environment.FBR_API_TOKEN}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          'x-correlation-id': correlationId,
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.environment.FBR_REQUEST_TIMEOUT_MS),
      });
      const responseText = await response.text();
      if (responseText.length > 1_048_576) throw new Error('FBR response exceeded 1 MiB');
      let parsed: unknown = null;
      if (responseText !== '') {
        try {
          parsed = JSON.parse(responseText) as unknown;
        } catch {
          parsed = { unparseableResponse: responseText.slice(0, 2_000) };
        }
      }
      const record = responseRecord(parsed);
      const validation = validationDetails(record);
      const httpRetryable = [408, 425, 429].includes(response.status) || response.status >= 500;
      const ambiguousSubmission =
        operation === 'SUBMIT' &&
        response.status !== 429 &&
        (response.status >= 500 || response.status === 408);
      const ok = response.ok && (operation === 'REFERENCE_DATA' || validation.valid);
      return {
        ok,
        httpStatus: response.status,
        response: record ?? (Array.isArray(parsed) ? { data: parsed } : null),
        errorCode: ok ? null : (validation.errorCode ?? `HTTP_${response.status}`),
        errorMessage: ok
          ? null
          : (validation.errorMessage ?? `FBR returned HTTP ${response.status}`),
        retryable: !ambiguousSubmission && httpRetryable,
        ambiguousSubmission,
        invoiceNumber: ok && operation === 'SUBMIT' ? textValue(record?.invoiceNumber) : null,
        durationMs: Date.now() - started,
        correlationId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown FBR transport error';
      return {
        ok: false,
        httpStatus: null,
        response: null,
        errorCode: operation === 'SUBMIT' ? 'AMBIGUOUS_SUBMISSION' : 'TRANSPORT_ERROR',
        errorMessage: message.slice(0, 2_000),
        retryable: operation !== 'SUBMIT',
        ambiguousSubmission: operation === 'SUBMIT',
        invoiceNumber: null,
        durationMs: Date.now() - started,
        correlationId,
      };
    }
  }
}
