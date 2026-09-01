import type { CashSessionStatus, PaymentMethod } from './domain.js';

export interface LoginResponse {
  readonly accessToken: string;
  readonly absoluteExpiresAt: string;
  readonly expiresAt: string;
  readonly sessionId: string;
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly displayName: string;
    readonly branchId: string;
    readonly branchTimezone: string;
    readonly terminalId: string;
    readonly terminalCode: string;
    readonly terminalName: string;
    readonly permissions: readonly string[];
  };
}

export interface MedicineSearchResult {
  readonly id: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly strength: string | null;
  readonly manufacturer: string | null;
  readonly barcode: string | null;
  readonly shelf: string | null;
  readonly availableQuantity: string;
  readonly nearestExpiry: string | null;
  readonly daysToExpiry: number | null;
  readonly salePrice: string | null;
}

export interface FailedJobsResponse {
  readonly summary: {
    readonly failed: number;
    readonly retryable: number;
    readonly processing: number;
    readonly staleProcessing: number;
  };
  readonly jobs: ReadonlyArray<{
    readonly id: string;
    readonly jobType: string;
    readonly attempts: number;
    readonly maxAttempts: number;
    readonly lastError: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }>;
}

export interface ExpiryRiskItem {
  readonly batch_id: string;
  readonly medicine_name: string;
  readonly batch_number: string;
  readonly expiry_date: string;
  readonly quantity: string;
  readonly value_at_risk: string;
  readonly risk_bucket: string;
  readonly days_to_expiry: number;
  readonly status: string;
}

export interface ShelfRecommendation {
  readonly id: string;
  readonly medicine_name: string;
  readonly status: string;
  readonly confidence: string;
  readonly demand_class: string;
  readonly pick_count: string;
  readonly current_location: string | null;
  readonly suggested_location: string;
  readonly reason_snapshot: Record<string, unknown>;
}

export interface ReorderSuggestion {
  readonly id: string;
  readonly medicine_name: string;
  readonly status: string;
  readonly current_sellable_stock: string;
  readonly suggested_qty: string;
  readonly confidence: string;
  readonly expiry_risk_flag: boolean;
  readonly effective_lead_time_days: number;
  readonly reason: Record<string, unknown>;
}

export interface ReturnLookup {
  readonly sale: {
    readonly id: string;
    readonly invoice_number: string;
    readonly total: string;
    readonly created_at: string;
  };
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly medicine_name: string;
    readonly sold_quantity: string;
    readonly returned_quantity: string;
    readonly eligible_quantity: string;
    readonly batch_number: string;
  }>;
}

export interface ReturnCommandResult {
  readonly id: string;
  readonly returnNumber?: string;
  readonly status: string;
  readonly refundAmount?: string;
}

export type OwnerTool =
  | 'get_sales_summary'
  | 'get_profit_summary'
  | 'get_low_stock'
  | 'get_expiry_risk'
  | 'get_purchase_suggestions'
  | 'get_supplier_price_comparison'
  | 'get_shelf_recommendations'
  | 'get_returns_summary'
  | 'get_cash_reconciliation_summary';

export interface OwnerAnswer {
  readonly facts: unknown;
  readonly explanation: string | null;
  readonly status: string;
  readonly dataBasis: string;
  readonly reportPath: string;
}

export interface CashSessionSummary {
  readonly id: string;
  readonly status: CashSessionStatus;
  readonly cashierUserId: string;
  readonly cashierName: string;
  readonly openingFloat: string;
  readonly cashSales: string;
  readonly accountPayments: string;
  readonly cashRefunds: string;
  readonly cashIn: string;
  readonly cashOut: string;
  readonly expectedCash: string;
  readonly countedCash: string | null;
  readonly variance: string | null;
  readonly varianceApprovalThreshold: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly closingNotes: string | null;
}

export interface SaleDraftResult {
  readonly id: string;
  readonly status: string;
  readonly total: string;
}

export interface ReservedSaleDraft extends SaleDraftResult {
  readonly reservationCount: number;
  readonly reservedUntil: string;
  readonly subtotal: string;
}

export interface FinalizedSale {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly total: string;
  readonly fiscalStatus: string;
  readonly returnLookupToken: string;
  readonly returnLookupPath: string;
}

export interface SalePayment {
  readonly method: PaymentMethod;
  readonly amount: string;
  readonly tendered_amount: string | null;
  readonly change_amount: string | null;
  readonly reference: string | null;
}

export interface SaleReceipt {
  readonly sale: {
    readonly id: string;
    readonly invoice_number: string;
    readonly subtotal: string;
    readonly discount_total: string;
    readonly tax_total: string;
    readonly total: string;
    readonly created_at: string;
    readonly branch_name: string;
    readonly branch_address: string | null;
    readonly branch_phone: string | null;
    readonly cashier_name: string;
    readonly customer_id: string | null;
    readonly customer_name: string | null;
    readonly customer_phone: string | null;
    readonly return_lookup_token: string;
    readonly fiscal_status: string;
    readonly fiscal_invoice_number: string | null;
  };
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly strength: string | null;
    readonly batch_number: string;
    readonly expiry_date: string;
    readonly quantity: string;
    readonly unit_price: string;
    readonly line_total: string;
  }>;
  readonly payments: readonly SalePayment[];
  readonly returnQrPayload: string;
}

export interface SaleReceiptSearchResult {
  readonly id: string;
  readonly invoice_number: string;
  readonly total: string;
  readonly created_at: string;
  readonly cashier_name: string;
}

export interface SalePaymentInput {
  readonly method: PaymentMethod;
  readonly amount: string;
  readonly tenderedAmount?: string;
  readonly reference?: string;
}

export interface CustomerSummary {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly address: string | null;
  readonly creditLimit: string;
  readonly balance: string;
  readonly availableCredit: string;
  readonly isActive: boolean;
  readonly createdAt: string;
}

export interface CustomerLedgerEntry {
  readonly id: string;
  readonly entryType: 'OPENING_BALANCE' | 'CREDIT_SALE' | 'PAYMENT' | 'ADJUSTMENT';
  readonly amountDelta: string;
  readonly balanceAfter: string;
  readonly saleId: string | null;
  readonly invoiceNumber: string | null;
  readonly paymentMethod: Exclude<PaymentMethod, 'CREDIT'> | null;
  readonly reference: string | null;
  readonly reason: string | null;
  readonly performedBy: string;
  readonly createdAt: string;
}

export interface CustomerStatement {
  readonly customer: CustomerSummary;
  readonly entries: readonly CustomerLedgerEntry[];
}

export interface CustomerAgingReport {
  readonly customerCount: number;
  readonly total: string;
  readonly current: string;
  readonly days31To60: string;
  readonly days61To90: string;
  readonly over90Days: string;
  readonly asOf: string;
}

export interface DashboardSnapshot {
  readonly metricDate: string;
  readonly netSales: string;
  readonly grossProfitEstimate: string;
  readonly cashCollected: string;
  readonly nonCashCollected: string;
  readonly refunds: string;
  readonly invoiceCount: string;
  readonly metrics: {
    readonly receivables: string;
    readonly expiryValueAtRisk: string;
    readonly lowStockCount: number;
    readonly failedFiscalSubmissions: number;
    readonly netCashVariance: string;
    readonly deadStockValue: string;
    readonly topMovers: ReadonlyArray<{
      readonly medicineId: string;
      readonly name: string;
      readonly quantity: string;
      readonly netSales: string;
    }>;
    readonly lastSuccessfulBackup: {
      readonly id: string;
      readonly backupType: string;
      readonly finishedAt: string | null;
      readonly sizeBytes: string | null;
      readonly checksum: string | null;
    } | null;
    readonly lastRestoreDrill: {
      readonly id: string;
      readonly finishedAt: string | null;
      readonly destination: string | null;
    } | null;
  };
  readonly updatedAt: string;
}
