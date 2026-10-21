import type {
  AiAssistantAudit,
  BackupOverview,
  BudgetRegimenResult,
  CashSessionSummary,
  CatalogImportResult,
  CustomerAgingReport,
  CustomerStatement,
  CustomerSummary,
  ExpiryRiskItem,
  FailedJobsResponse,
  FinalizedSale,
  FiscalInvoiceAttempt,
  FiscalInvoiceStatus,
  FiscalInvoiceSummary,
  FiscalOverview,
  LoginResponse,
  MedicineSearchResult,
  MedicineStockDetail,
  OpeningStockImportResult,
  OperationalAlertsResponse,
  OwnerAnswer,
  OwnerDashboard,
  OwnerTool,
  PurchaseOrderDetail,
  PurchaseOrderStatus,
  PurchaseOrderSummary,
  RefundMethod,
  ReorderSuggestion,
  ReservedSaleDraft,
  ReturnCommandResult,
  ReturnDisposition,
  ReturnLookup,
  ReturnStatus,
  ReturnSummary,
  SaleDraftResult,
  SalePaymentInput,
  SaleReceipt,
  SaleReceiptSearchResult,
  ShelfRecommendation,
  StockOverview,
  SupplierSummary,
  TabularReport,
  TabularReportName,
} from '@pharmacy/shared';

import { usePharmacyStore } from './store';

export type {
  AiAssistantAudit,
  BackupOverview,
  BudgetRegimenResult,
  CashSessionSummary,
  CatalogImportResult,
  CustomerAgingReport,
  CustomerStatement,
  CustomerSummary,
  ExpiryRiskItem,
  FailedJobsResponse,
  FinalizedSale,
  FiscalInvoiceAttempt,
  FiscalInvoiceStatus,
  FiscalInvoiceSummary,
  FiscalOverview,
  LoginResponse,
  MedicineSearchResult,
  MedicineStockDetail,
  OpeningStockImportResult,
  OperationalAlertsResponse,
  OwnerAnswer,
  OwnerDashboard,
  OwnerTool,
  PurchaseOrderDetail,
  PurchaseOrderStatus,
  PurchaseOrderSummary,
  RefundMethod,
  ReorderSuggestion,
  ReservedSaleDraft,
  ReturnCommandResult,
  ReturnDisposition,
  ReturnLookup,
  ReturnStatus,
  ReturnSummary,
  SaleDraftResult,
  SaleReceipt,
  SaleReceiptSearchResult,
  ShelfRecommendation,
  StockOverview,
  SupplierSummary,
  TabularReport,
  TabularReportName,
};

const runtimeEnvironment = import.meta.env as unknown as { readonly VITE_API_URL?: string };
const API_URL = runtimeEnvironment.VITE_API_URL ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Nest returns `message` as a string, a list of strings, or (for request validation) a
 * flattened field-error object. Turn whichever arrives into one sentence for the operator.
 */
export function readableError(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    const message = record.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message) && message.length > 0) return message.map(String).join('; ');
    const fieldErrors = record.fieldErrors;
    if (typeof fieldErrors === 'object' && fieldErrors !== null) {
      const parts = Object.entries(fieldErrors as Record<string, unknown>).flatMap(
        ([field, errors]) =>
          Array.isArray(errors) && errors.length > 0 ? [`${field}: ${String(errors[0])}`] : [],
      );
      if (parts.length > 0) return parts.join('; ');
    }
    const formErrors = record.formErrors;
    if (Array.isArray(formErrors) && formErrors.length > 0)
      return formErrors.map(String).join('; ');
  }
  if (status === 0)
    return 'The shop server could not be reached. Check the network cable or Wi-Fi.';
  if (status === 403) return 'Your account is not allowed to do this.';
  if (status === 404) return 'That record was not found.';
  if (status >= 500) return 'The shop server hit an error. Try again; if it repeats, call support.';
  return `Request failed (${String(status)})`;
}

async function request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(readableError(null, 0), 0);
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 401 && path !== '/auth/login') {
      window.dispatchEvent(new CustomEvent('pharmacy:unauthorized'));
    }
    throw new ApiError(readableError(body, response.status), response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function currentToken(): string {
  return usePharmacyStore.getState().session?.accessToken ?? '';
}

function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' }, currentToken());
}

function send<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<T> {
  return request<T>(
    path,
    { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    currentToken(),
  );
}

function query(parameters: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/* ---------- Session ---------- */

export function login(username: string, password: string, terminalCode: string) {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, terminalCode }),
  });
}

export function logout(token: string) {
  return request<{ readonly revoked: boolean }>('/auth/logout', { method: 'POST' }, token);
}

export function checkLanHealth() {
  return request<{ readonly status: string }>('/health/ready', { method: 'GET' });
}

export function changeOwnPassword(currentPassword: string, newPassword: string) {
  return send<{ readonly id: string }>('POST', '/admin/users/me/password', {
    currentPassword,
    newPassword,
  });
}

/* ---------- Counter ---------- */

export async function searchMedicines(text: string, limit = 25) {
  return (
    await get<{ data: MedicineSearchResult[] }>(
      `/catalog/medicines/search${query({ query: text, limit })}`,
    )
  ).data;
}

export function createSaleDraft(
  terminalId: string,
  items: ReadonlyArray<{ readonly medicineId: string; readonly quantity: string }>,
) {
  return send<SaleDraftResult>('POST', '/pos/drafts', { terminalId, items });
}

export function reserveSaleDraft(draftId: string) {
  return send<ReservedSaleDraft>('POST', `/pos/drafts/${draftId}/reserve`);
}

export function cancelSaleDraft(draftId: string) {
  return send<{ readonly status: string; readonly releasedReservations: number }>(
    'POST',
    `/pos/drafts/${draftId}/cancel`,
  );
}

export function applySaleDiscount(
  draftId: string,
  input: {
    readonly invoiceDiscount: string;
    readonly reason: string;
    readonly clientRequestId: string;
    readonly approverUsername?: string;
    readonly approverPassword?: string;
  },
) {
  return send<{ readonly total: string; readonly approvalLevel: string }>(
    'POST',
    `/pos/drafts/${draftId}/discount`,
    { ...input, lineDiscounts: [] },
  );
}

export function finalizeSale(input: {
  readonly cashSessionId: string;
  readonly draftId: string;
  readonly clientRequestId: string;
  readonly payments: readonly SalePaymentInput[];
  readonly customerId?: string;
}) {
  return send<FinalizedSale>('POST', '/pos/sales/finalize', input);
}

export function getSaleReceipt(saleId: string) {
  return get<SaleReceipt>(`/pos/sales/${saleId}/receipt`);
}

export async function findSalesForReceipt(text: string) {
  return (await get<{ data: SaleReceiptSearchResult[] }>(`/pos/sales${query({ query: text })}`))
    .data;
}

export function reprintSaleReceipt(saleId: string) {
  return send<SaleReceipt>('POST', `/pos/sales/${saleId}/reprint`);
}

export function calculateBudgetRegimen(input: {
  readonly budget: string;
  readonly items: ReadonlyArray<{
    readonly medicineId: string;
    readonly prescribedBaseUnitsPerDay: string;
    readonly minimumSaleIncrement: string;
  }>;
}) {
  return send<BudgetRegimenResult>('POST', '/budget-regimen/calculate', {
    ...input,
    persistAudit: false,
  });
}

/* ---------- Cash ---------- */

export function getCurrentCashSession() {
  return get<CashSessionSummary | null>('/cash-sessions/current');
}

export async function getPendingCashVariances() {
  return (await get<{ data: CashSessionSummary[] }>('/cash-sessions/pending-variance')).data;
}

export function openCashSession(openingFloat: string, clientRequestId: string) {
  return send<CashSessionSummary>('POST', '/cash-sessions/open', { openingFloat, clientRequestId });
}

export function addCashMovement(
  sessionId: string,
  input: {
    readonly movementType: 'CASH_IN' | 'CASH_OUT';
    readonly amount: string;
    readonly reason: string;
    readonly clientRequestId: string;
  },
) {
  return send<{ readonly session: CashSessionSummary }>(
    'POST',
    `/cash-sessions/${sessionId}/movements`,
    input,
  );
}

export function closeCashSession(
  sessionId: string,
  input: {
    readonly countedCash: string;
    readonly closingNotes?: string;
    readonly clientRequestId: string;
  },
) {
  return send<CashSessionSummary>('POST', `/cash-sessions/${sessionId}/close`, input);
}

export function approveCashVariance(sessionId: string, notes: string, clientRequestId: string) {
  return send<CashSessionSummary>('POST', `/cash-sessions/${sessionId}/approve-variance`, {
    notes,
    clientRequestId,
  });
}

/* ---------- Customers ---------- */

export async function searchCustomers(text: string, limit = 25) {
  return (await get<{ data: CustomerSummary[] }>(`/customers${query({ query: text, limit })}`))
    .data;
}

export function createCustomer(input: {
  readonly name: string;
  readonly phone?: string;
  readonly address?: string;
  readonly creditLimit: string;
  readonly openingBalance: string;
}) {
  return send<CustomerSummary>('POST', '/customers', input);
}

export function updateCustomer(
  customerId: string,
  input: {
    readonly name?: string;
    readonly phone?: string | null;
    readonly address?: string | null;
    readonly creditLimit?: string;
    readonly isActive?: boolean;
  },
) {
  return send<CustomerSummary>('PATCH', `/customers/${customerId}`, input);
}

export function getCustomerStatement(customerId: string) {
  return get<CustomerStatement>(`/customers/${customerId}/statement`);
}

export function getReceivablesAging() {
  return get<CustomerAgingReport>('/customers/receivables/aging');
}

export function recordCustomerPayment(
  customerId: string,
  input: {
    readonly amount: string;
    readonly method: 'CASH' | 'CARD' | 'BANK_TRANSFER';
    readonly cashSessionId?: string;
    readonly reference?: string;
    readonly clientRequestId: string;
  },
) {
  return send<{ readonly id: string; readonly balance: string }>(
    'POST',
    `/customers/${customerId}/payments`,
    input,
  );
}

/* ---------- Returns ---------- */

export function lookupReturnByToken(receiptToken: string) {
  return get<ReturnLookup>(`/returns/lookup/${encodeURIComponent(receiptToken)}`);
}

export function lookupReturnByInvoice(invoiceNumber: string) {
  return get<ReturnLookup>(`/returns/invoices/${encodeURIComponent(invoiceNumber)}`);
}

export async function listReturns(status?: ReturnStatus) {
  return (await get<{ data: ReturnSummary[] }>(`/returns${query({ status, limit: 100 })}`)).data;
}

export function requestReturn(
  receiptToken: string,
  input: {
    readonly reason: string;
    readonly clientRequestId: string;
    readonly items: ReadonlyArray<{
      readonly saleItemId: string;
      readonly quantity: string;
      readonly disposition: ReturnDisposition;
    }>;
  },
) {
  return send<ReturnCommandResult>(
    'POST',
    `/returns/lookup/${encodeURIComponent(receiptToken)}/request`,
    input,
  );
}

export function approveReturn(returnId: string) {
  return send<ReturnCommandResult>('POST', `/returns/${returnId}/approve`);
}

export function rejectReturn(returnId: string, reason: string) {
  return send<ReturnCommandResult>('POST', `/returns/${returnId}/reject`, { reason });
}

export function refundReturn(
  returnId: string,
  input: {
    readonly method: RefundMethod;
    readonly cashSessionId?: string;
    readonly reference?: string;
  },
) {
  return send<ReturnCommandResult>('POST', `/returns/${returnId}/refund`, input);
}

/* ---------- Stock ---------- */

export function getStockOverview(input: {
  readonly query: string;
  readonly filter: 'ALL' | 'IN_STOCK' | 'LOW' | 'OUT' | 'EXPIRING';
  readonly limit: number;
  readonly offset: number;
}) {
  return get<StockOverview>(`/stock${query(input)}`);
}

export function getMedicineStock(medicineId: string) {
  return get<MedicineStockDetail>(`/stock/medicines/${medicineId}`);
}

export function setReorderPolicy(
  medicineId: string,
  input: {
    readonly minimumStock: string;
    readonly preferredSupplierId?: string | null;
    readonly leadTimeDays?: number;
    readonly safetyDays?: number;
    readonly targetCoverageDays?: number;
    readonly minimumOrderQuantity?: string;
    readonly orderMultiple?: string;
    readonly isActive?: boolean;
  },
) {
  return send<{ readonly updated: true }>(
    'PUT',
    `/stock/medicines/${medicineId}/reorder-policy`,
    input,
  );
}

export function importOpeningStock(
  mode: 'VALIDATE' | 'APPLY',
  rows: readonly Record<string, unknown>[],
  clientRequestId: string,
) {
  return send<OpeningStockImportResult>('POST', '/stock/opening-stock/import', {
    mode,
    rows,
    clientRequestId,
  });
}

export function updateBatchPrice(
  batchId: string,
  input: {
    readonly salePrice: string;
    readonly maximumRetailPrice?: string | null;
    readonly reason: string;
    readonly clientRequestId: string;
  },
) {
  return send<Record<string, unknown>>('POST', `/inventory/batches/${batchId}/price`, input);
}

export function adjustBatchStock(
  batchId: string,
  input:
    | {
        readonly type: 'COUNT';
        readonly countedQuantity: string;
        readonly reason: string;
        readonly clientRequestId: string;
      }
    | {
        readonly type: 'SCRAP';
        readonly quantity: string;
        readonly reason: string;
        readonly clientRequestId: string;
      },
) {
  return send<{ readonly quantityAfter: string }>(
    'POST',
    `/inventory/batches/${batchId}/adjustments`,
    input,
  );
}

export function getInventoryAttention() {
  return get<Record<string, string>>('/inventory-intelligence/attention');
}

export async function getExpiryRisk() {
  return (await get<{ data: ExpiryRiskItem[] }>('/expiry-risk?limit=100')).data;
}

export function actOnExpiryItem(
  workItemId: string,
  input: {
    readonly action:
      'REVIEWED' | 'SUPPLIER_RETURN_CANDIDATE' | 'QUARANTINED' | 'SCRAPPED' | 'RESOLVED';
    readonly notes: string;
  },
) {
  return send<Record<string, unknown>>('POST', `/expiry-work-items/${workItemId}/action`, input);
}

export async function getShelfRecommendations() {
  return (await get<{ data: ShelfRecommendation[] }>('/shelf-recommendations?limit=100')).data;
}

export function reviewShelfRecommendation(id: string, decision: 'APPLY' | 'DISMISS') {
  return send<Record<string, unknown>>('POST', `/shelf-recommendations/${id}/review`, { decision });
}

export async function getReorderSuggestions() {
  return (await get<{ data: ReorderSuggestion[] }>('/reorder-suggestions?limit=100')).data;
}

export function reviewReorderSuggestion(id: string, decision: 'REVIEW' | 'DISMISS') {
  return send<Record<string, unknown>>('POST', `/reorder-suggestions/${id}/review`, { decision });
}

export function createDraftFromSuggestion(
  id: string,
  input: {
    readonly supplierId?: string;
    readonly quantity?: string;
    readonly clientRequestId: string;
  },
) {
  return send<{ readonly id: string; readonly orderNumber: string }>(
    'POST',
    `/reorder-suggestions/${id}/create-draft-po`,
    input,
  );
}

/* ---------- Purchasing ---------- */

export async function listPurchasableSuppliers() {
  return (await get<{ data: SupplierSummary[] }>('/suppliers')).data;
}

export async function listPurchaseOrders(status?: PurchaseOrderStatus) {
  return (
    await get<{ data: PurchaseOrderSummary[] }>(`/purchase-orders${query({ status, limit: 100 })}`)
  ).data;
}

export function getPurchaseOrder(purchaseOrderId: string) {
  return get<PurchaseOrderDetail>(`/purchase-orders/${purchaseOrderId}`);
}

export interface PurchaseOrderDraftLine {
  readonly medicineId: string;
  readonly orderedQuantity: string;
  readonly unitCost: string;
  readonly lineDiscount: string;
  readonly bonusQuantity: string;
  readonly baseUnitsPerOrderUnit: string;
}

export function createPurchaseOrder(input: {
  readonly supplierId: string;
  readonly supplierInvoiceNumber?: string;
  readonly items: readonly PurchaseOrderDraftLine[];
  readonly clientRequestId: string;
}) {
  return send<Omit<PurchaseOrderDetail, 'receipts'>>('POST', '/purchase-orders', input);
}

export function markPurchaseOrderOrdered(purchaseOrderId: string, clientRequestId: string) {
  return send<PurchaseOrderDetail>('POST', `/purchase-orders/${purchaseOrderId}/order`, {
    clientRequestId,
  });
}

export function cancelPurchaseOrder(
  purchaseOrderId: string,
  reason: string,
  clientRequestId: string,
) {
  return send<PurchaseOrderDetail>('POST', `/purchase-orders/${purchaseOrderId}/cancel`, {
    reason,
    clientRequestId,
  });
}

export interface GoodsReceiptLineInput {
  readonly purchaseOrderItemId: string;
  readonly receivedQuantity: string;
  readonly receivedBonusQuantity: string;
  readonly batchNumber: string;
  readonly expiryDate: string;
  readonly salePricePerBaseUnit: string;
  readonly maximumRetailPricePerBaseUnit?: string;
}

export function receivePurchaseOrder(
  purchaseOrderId: string,
  input: {
    readonly supplierInvoiceNumber?: string;
    readonly lines: readonly GoodsReceiptLineInput[];
    readonly clientRequestId: string;
  },
) {
  return send<PurchaseOrderDetail>('POST', `/purchase-orders/${purchaseOrderId}/receive`, input);
}

export function addSupplierQuote(input: {
  readonly supplierId: string;
  readonly medicineId: string;
  readonly quotedUnitCost: string;
  readonly quoteUnit: string;
  readonly baseUnitsPerQuoteUnit: string;
  readonly source: string;
}) {
  return send<Record<string, unknown>>('POST', '/supplier-quotes', input);
}

export async function getSupplierComparison(medicineId: string) {
  return (
    await get<{
      data: Array<{
        supplier_id: string;
        supplier_name: string;
        effective_unit_cost: string;
        observed_at: string | null;
        source_type: string;
        lead_time_days: number;
      }>;
    }>(`/products/${medicineId}/supplier-comparison`)
  ).data;
}

/* ---------- Reports and dashboard ---------- */

export function getTabularReport(
  report: TabularReportName,
  range: {
    readonly from?: string;
    readonly to?: string;
    readonly limit?: number;
    readonly days?: number;
  },
) {
  return get<TabularReport>(`/reports/tables/${report}${query(range)}`);
}

export function getOwnerOverview(date?: string, trendDays = 14) {
  return get<OwnerDashboard>(`/dashboard/overview${query({ date, trendDays })}`);
}

export function askOwnerAssistant(question: string, tool: OwnerTool) {
  return send<OwnerAnswer>('POST', '/owner-ai/chat', { question, tool, arguments: {} });
}

/* ---------- Operations ---------- */

export function getFailedJobs(limit = 50) {
  return get<FailedJobsResponse>(`/operations/jobs/failed${query({ limit })}`);
}

export function getOperationalAlerts(status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' = 'OPEN') {
  return get<OperationalAlertsResponse>(`/operations/alerts${query({ status, limit: 100 })}`);
}

export function acknowledgeAlert(alertId: string) {
  return send<Record<string, unknown>>('POST', `/operations/alerts/${alertId}/acknowledge`);
}

export function getFiscalOverview(status?: FiscalInvoiceStatus) {
  return get<FiscalOverview>(`/fiscal/invoices${query({ status, limit: 100 })}`);
}

export function getFiscalAttempts(fiscalInvoiceId: string) {
  return get<{
    readonly invoice: FiscalInvoiceSummary;
    readonly attempts: readonly FiscalInvoiceAttempt[];
  }>(`/fiscal/invoices/${fiscalInvoiceId}/attempts`);
}

export function retryFiscalInvoice(
  fiscalInvoiceId: string,
  reason: string,
  clientRequestId: string,
) {
  return send<{ readonly id: string; readonly status: string }>(
    'POST',
    `/fiscal/invoices/${fiscalInvoiceId}/retry`,
    { reason, clientRequestId },
  );
}

export function getBackupOverview() {
  return get<BackupOverview>('/operations/backups?limit=30');
}

export async function getAiAudits() {
  return (await get<{ data: AiAssistantAudit[] }>('/owner-ai/audits?limit=50')).data;
}

/* ---------- Administration ---------- */

export function adminGet<T>(path: string) {
  return get<T>(`/admin${path}`);
}

export function adminPost<T>(path: string, body: unknown) {
  return send<T>('POST', `/admin${path}`, body);
}

export function adminPatch<T>(path: string, body: unknown) {
  return send<T>('PATCH', `/admin${path}`, body);
}

export function importCatalog(
  mode: 'VALIDATE' | 'APPLY',
  rows: readonly Record<string, unknown>[],
  clientRequestId: string,
) {
  return send<CatalogImportResult>('POST', '/admin/medicines/import', {
    mode,
    rows,
    clientRequestId,
  });
}
