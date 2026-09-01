export interface FiscalInvoiceItem {
  readonly hsCode: string | null;
  readonly productDescription: string;
  readonly rate: string;
  readonly uoM: string;
  readonly quantity: string;
  readonly totalValues: string;
  readonly valueSalesExcludingST: string;
  readonly fixedNotifiedValueOrRetailPrice: string;
  readonly salesTaxApplicable: string;
  readonly salesTaxWithheldAtSource: string;
  readonly extraTax: string;
  readonly furtherTax: string;
  readonly sroScheduleNo: string;
  readonly fedPayable: string;
  readonly discount: string;
  readonly saleType: string;
  readonly sroItemSerialNo: string;
}

export interface FiscalInvoice {
  readonly invoiceType: 'Sale Invoice' | 'Credit Note';
  readonly invoiceDate: string;
  readonly sellerNTNCNIC: string | null;
  readonly sellerSTRN: string | null;
  readonly sellerPOSRegistrationNumber: string | null;
  readonly sellerBusinessName: string;
  readonly sellerProvince: string | null;
  readonly sellerAddress: string;
  readonly buyerNTNCNIC: string;
  readonly buyerBusinessName: string;
  readonly buyerProvince: string;
  readonly buyerAddress: string;
  readonly buyerRegistrationType: 'Registered' | 'Unregistered';
  readonly invoiceRefNo: string;
  readonly scenarioId?: string;
  readonly items: readonly FiscalInvoiceItem[];
}

export interface FiscalGatewayResult {
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly response: Record<string, unknown> | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly retryable: boolean;
  readonly ambiguousSubmission: boolean;
  readonly invoiceNumber: string | null;
  readonly durationMs: number;
  readonly correlationId: string;
}

export type FiscalReferenceDataKind =
  'provinces' | 'document-types' | 'items' | 'transaction-types' | 'units-of-measure';

export interface FiscalInvoiceGateway {
  validateInvoice(invoice: FiscalInvoice): Promise<FiscalGatewayResult>;
  submitInvoice(invoice: FiscalInvoice): Promise<FiscalGatewayResult>;
  getReferenceData(kind: FiscalReferenceDataKind): Promise<FiscalGatewayResult>;
}
