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

export interface OperationalAlertsResponse {
  readonly summary: { readonly total: number; readonly critical: number };
  readonly alerts: ReadonlyArray<{
    readonly id: string;
    readonly alertType:
      'FAILED_JOB' | 'FAILED_FISCAL_SUBMISSION' | 'CASH_VARIANCE' | 'BACKUP_RESTORE_FAILURE';
    readonly severity: 'WARNING' | 'CRITICAL';
    readonly status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
    readonly title: string;
    readonly details: Record<string, unknown>;
    readonly firstObservedAt: string;
    readonly lastObservedAt: string;
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
  readonly medicine_id: string;
  readonly work_item_id: string | null;
  readonly work_item_status: string | null;
  readonly work_item_action: string | null;
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

export type ReturnDisposition = 'RESTOCK_SELLABLE' | 'QUARANTINE' | 'SCRAP';
export type RefundMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CUSTOMER_ACCOUNT';
export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDED';

export interface ReturnLookup {
  readonly sale: {
    readonly id: string;
    readonly invoiceNumber: string;
    readonly status: string;
    readonly total: string;
    readonly discountTotal: string;
    readonly createdAt: string;
    readonly lookupToken: string;
    readonly customerId: string | null;
    readonly customerName: string | null;
  };
  readonly payments: ReadonlyArray<{ readonly method: string; readonly amount: string }>;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly medicineName: string;
    readonly strength: string | null;
    readonly batchNumber: string;
    readonly expiryDate: string;
    readonly expired: boolean;
    readonly soldQuantity: string;
    readonly returnedQuantity: string;
    readonly eligibleQuantity: string;
    readonly unitPrice: string;
    /** Amount the customer paid for the whole line after its share of invoice discount. */
    readonly netPaid: string;
  }>;
  readonly returns: readonly ReturnSummary[];
}

export interface ReturnSummary {
  readonly id: string;
  readonly returnNumber: string;
  readonly status: ReturnStatus;
  readonly reason: string;
  readonly saleId: string;
  readonly invoiceNumber: string;
  readonly lookupToken: string | null;
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly refundAmount: string;
  readonly refundMethod: RefundMethod | null;
  readonly rejectionReason: string | null;
  readonly itemCount: number;
  /** Largest refund each route may still pay for this sale; see ReturnsService.refundLimits. */
  readonly refundLimits: { readonly cashOrCard: string; readonly customerAccount: string };
}

export interface ReturnCommandResult {
  readonly id: string;
  readonly returnNumber?: string;
  readonly status: string;
  readonly refundAmount?: string;
  readonly refundMethod?: RefundMethod;
  readonly idempotentReplay?: boolean;
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
    readonly seller_ntn_cnic: string | null;
    readonly seller_strn: string | null;
    readonly pos_registration_number: string | null;
    readonly terminal_name: string;
  };
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly strength: string | null;
    readonly batch_number: string;
    readonly expiry_date: string;
    readonly quantity: string;
    readonly unit_price: string;
    readonly discount_amount: string;
    readonly tax_rate: string;
    readonly tax_amount: string;
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
  readonly entryType:
    'OPENING_BALANCE' | 'CREDIT_SALE' | 'PAYMENT' | 'ADJUSTMENT' | 'RETURN_CREDIT';
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

export type PurchaseOrderStatus =
  'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderSummary {
  readonly id: string;
  readonly order_number: string;
  readonly status: PurchaseOrderStatus;
  readonly supplier_invoice_number: string | null;
  readonly total_cost: string;
  readonly supplier_id: string;
  readonly supplier_name: string;
  readonly ordered_at: string | null;
  readonly received_at: string | null;
  readonly created_at: string;
  readonly line_count: number;
  readonly ordered_quantity: string;
  readonly received_quantity: string;
}

export interface PurchaseOrderLine {
  readonly id: string;
  readonly medicine_id: string;
  readonly medicine_name: string;
  readonly ordered_qty: string;
  readonly received_qty: string;
  readonly bonus_qty: string;
  readonly received_bonus_qty: string;
  readonly unit_cost: string;
  readonly line_discount: string;
  readonly base_units_per_order_unit: string;
}

export interface PurchaseOrderReceiptSummary {
  readonly id: string;
  readonly supplier_invoice_number: string | null;
  readonly received_at: string;
  readonly received_by: string;
  readonly received_base_quantity: string;
}

export interface PurchaseOrderDetail {
  readonly id: string;
  readonly order_number: string;
  readonly status: PurchaseOrderStatus;
  readonly supplier_invoice_number: string | null;
  readonly total_cost: string;
  readonly supplier_id: string;
  readonly supplier_name: string;
  readonly ordered_at: string | null;
  readonly received_at: string | null;
  readonly created_at: string;
  readonly cancelled_at: string | null;
  readonly cancel_reason: string | null;
  readonly items: readonly PurchaseOrderLine[];
  readonly receipts: readonly PurchaseOrderReceiptSummary[];
}

export interface SupplierSummary {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly phone: string | null;
  readonly leadTimeDays: number;
  readonly isActive: boolean;
}

export type DeterministicReportName =
  | 'sales'
  | 'profit'
  | 'low-stock'
  | 'expiry-risk'
  | 'purchase-suggestions'
  | 'returns'
  | 'cash-reconciliation';

export interface DeterministicReport {
  readonly facts: unknown;
  readonly dataBasis: string;
  readonly reportPath: string;
}

export type FiscalInvoiceStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'VALIDATING'
  | 'VALIDATED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_NEEDS_REVIEW'
  | 'VOID_OR_CREDIT_NOTE_PENDING';

export interface FiscalInvoiceSummary {
  readonly id: string;
  readonly saleId: string;
  readonly invoiceNumber: string;
  readonly mode: string;
  readonly status: FiscalInvoiceStatus;
  readonly fiscalInvoiceNumber: string | null;
  readonly submittedAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly attemptCount: number;
  readonly total: string;
  readonly saleCreatedAt: string;
  readonly updatedAt: string;
  readonly retryable: boolean;
}

export interface FiscalInvoiceAttempt {
  readonly id: string;
  readonly attemptNumber: number;
  readonly operation: string;
  readonly outcome: 'SUCCESS' | 'RETRYABLE_FAILURE' | 'PERMANENT_FAILURE';
  readonly httpStatus: number | null;
  readonly durationMs: number | null;
  readonly correlationId: string | null;
  readonly errorMessage: string | null;
  readonly attemptedAt: string;
}

export interface FiscalOverview {
  readonly mode: string;
  readonly outboundEnabled: boolean;
  readonly counts: Readonly<Record<FiscalInvoiceStatus, number>>;
  readonly invoices: readonly FiscalInvoiceSummary[];
}

export interface BackupRunSummary {
  readonly id: string;
  readonly backupType: 'LOGICAL' | 'PHYSICAL' | 'RESTORE_DRILL';
  readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly destination: string;
  readonly encrypted: boolean;
  readonly sizeBytes: string | null;
  readonly checksum: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationSeconds: number | null;
  readonly errorMessage: string | null;
}

export interface BackupOverview {
  readonly lastSuccessfulBackup: BackupRunSummary | null;
  readonly lastSuccessfulRestoreDrill: BackupRunSummary | null;
  readonly runs: readonly BackupRunSummary[];
}

export interface AiAssistantAudit {
  readonly id: string;
  readonly userDisplayName: string;
  readonly toolName: string;
  readonly provider: string;
  readonly model: string | null;
  readonly status: 'SUCCEEDED' | 'DISABLED' | 'RATE_LIMITED' | 'FAILED' | 'TIMED_OUT';
  readonly latencyMs: number;
  readonly errorCode: string | null;
  readonly createdAt: string;
}

export interface CatalogImportIssue {
  readonly row: number;
  readonly field: string;
  readonly message: string;
}

export interface CatalogImportResult {
  readonly mode: 'VALIDATE' | 'APPLY';
  readonly applied: boolean;
  readonly totalRows: number;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly rejected: number;
  readonly issues: readonly CatalogImportIssue[];
  readonly idempotentReplay: boolean;
}

export type StockStatus = 'OK' | 'LOW' | 'OUT' | 'EXPIRING';

export interface StockOverviewRow {
  readonly medicineId: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly strength: string | null;
  readonly manufacturer: string | null;
  readonly sku: string | null;
  readonly barcode: string | null;
  /** Sellable, unexpired stock on hand. */
  readonly sellableQuantity: string;
  /** Held by open counter reservations; not yet sold. */
  readonly reservedQuantity: string;
  readonly availableQuantity: string;
  readonly quarantinedQuantity: string;
  readonly expiredQuantity: string;
  readonly nearestExpiry: string | null;
  readonly daysToExpiry: number | null;
  readonly salePrice: string | null;
  readonly valueAtCost: string;
  readonly valueAtRetail: string;
  readonly minimumStock: string | null;
  readonly averageDailySales: string;
  readonly daysOfCover: string | null;
  readonly status: StockStatus;
}

export interface StockOverview {
  readonly data: readonly StockOverviewRow[];
  readonly totals: {
    readonly matching: number;
    readonly valueAtCost: string;
    readonly valueAtRetail: string;
    readonly low: number;
    readonly out: number;
    readonly expiring: number;
  };
}

export interface MedicineStockDetail {
  readonly medicine: StockOverviewRow & { readonly unitName: string; readonly packSize: string };
  readonly policy: {
    readonly minimumStock: string;
    readonly preferredSupplierId: string | null;
    readonly preferredSupplierName: string | null;
    readonly leadTimeDays: number;
    readonly safetyDays: number;
    readonly targetCoverageDays: number;
    readonly minimumOrderQuantity: string;
    readonly orderMultiple: string;
    readonly isActive: boolean;
  } | null;
  readonly batches: ReadonlyArray<{
    readonly id: string;
    readonly batchNumber: string;
    readonly expiryDate: string;
    readonly daysToExpiry: number;
    readonly status: string;
    readonly currentQuantity: string;
    readonly costPrice: string;
    readonly salePrice: string;
    readonly maximumRetailPrice: string | null;
    readonly receivedAt: string;
    readonly source: string;
  }>;
  readonly movements: ReadonlyArray<{
    readonly id: string;
    readonly batchNumber: string;
    readonly movementType: string;
    readonly quantityDelta: string;
    readonly quantityAfter: string;
    readonly reason: string | null;
    readonly performedBy: string | null;
    readonly createdAt: string;
  }>;
}

export interface ImportIssue {
  readonly row: number;
  readonly field: string;
  readonly message: string;
}

export interface OpeningStockImportResult {
  readonly mode: 'VALIDATE' | 'APPLY';
  readonly applied: boolean;
  readonly totalRows: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly totalQuantity: string;
  readonly valueAtCost: string;
  readonly issues: readonly ImportIssue[];
  readonly idempotentReplay: boolean;
}

export type ReportColumnType =
  'text' | 'date' | 'datetime' | 'money' | 'quantity' | 'count' | 'percent';

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly type: ReportColumnType;
}

export type ReportCell = string | number | boolean | null;

/**
 * Every operational report has the same shape so it renders, totals, and exports the same
 * way. Money and quantities are exact decimal strings; dates are branch-local.
 */
export interface TabularReport {
  readonly report: string;
  readonly title: string;
  readonly dataBasis: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly columns: readonly ReportColumn[];
  readonly rows: ReadonlyArray<Readonly<Record<string, ReportCell>>>;
  readonly totals: Readonly<Record<string, ReportCell>> | null;
}

export type TabularReportName =
  | 'daily-sales'
  | 'profit'
  | 'item-sales'
  | 'returns-register'
  | 'cash-sessions'
  | 'stock-valuation'
  | 'expiry'
  | 'purchases'
  | 'stock-losses';

export interface OwnerDashboard {
  readonly date: string;
  readonly generatedAt: string;
  readonly sales: {
    readonly invoiceCount: number;
    readonly grossSales: string;
    readonly discounts: string;
    readonly refunds: string;
    readonly netSales: string;
    readonly costOfGoods: string;
    readonly grossProfit: string;
    readonly averageTicket: string;
    readonly cash: string;
    readonly card: string;
    readonly bankTransfer: string;
    readonly credit: string;
    readonly creditCollected: string;
  };
  readonly trend: ReadonlyArray<{
    readonly date: string;
    readonly netSales: string;
    readonly grossProfit: string;
    readonly invoiceCount: number;
  }>;
  readonly topItems: ReadonlyArray<{
    readonly medicineId: string;
    readonly name: string;
    readonly quantity: string;
    readonly netSales: string;
  }>;
  readonly position: {
    readonly receivables: string;
    readonly stockValueAtCost: string;
    readonly expiryValueAtRisk: string;
    readonly lowStockCount: number;
    readonly outOfStockCount: number;
    readonly openCashSessions: number;
    readonly pendingReturns: number;
    readonly pendingVariances: number;
    readonly failedFiscalSubmissions: number;
    readonly openAlerts: number;
  };
  readonly continuity: {
    readonly lastSuccessfulBackupAt: string | null;
    readonly lastRestoreDrillAt: string | null;
  };
}
