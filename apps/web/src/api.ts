import {
  createClientRequestId,
  type AiAssistantAudit,
  type BackupOverview,
  type BudgetRegimenResult,
  type CashSessionSummary,
  type CatalogImportResult,
  type CustomerStatement,
  type CustomerSummary,
  type DashboardSnapshot,
  type DeterministicReport,
  type DeterministicReportName,
  type ExpiryRiskItem,
  type FailedJobsResponse,
  type FinalizedSale,
  type FiscalInvoiceAttempt,
  type FiscalInvoiceStatus,
  type FiscalInvoiceSummary,
  type FiscalOverview,
  type LoginResponse,
  type MedicineSearchResult,
  type OwnerAnswer,
  type OperationalAlertsResponse,
  type OwnerTool,
  type PurchaseOrderDetail,
  type PurchaseOrderStatus,
  type PurchaseOrderSummary,
  type ReorderSuggestion,
  type ReservedSaleDraft,
  type ReturnCommandResult,
  type ReturnLookup,
  type SaleDraftResult,
  type SalePaymentInput,
  type SaleReceipt,
  type SaleReceiptSearchResult,
  type ShelfRecommendation,
  type SupplierSummary,
  type BackupRunSummary,
} from '@pharmacy/shared';

export type {
  AiAssistantAudit,
  BackupOverview,
  BackupRunSummary,
  BudgetRegimenResult,
  CashSessionSummary,
  CatalogImportResult,
  CustomerStatement,
  CustomerSummary,
  DashboardSnapshot,
  DeterministicReport,
  DeterministicReportName,
  ExpiryRiskItem,
  FailedJobsResponse,
  FinalizedSale,
  FiscalInvoiceAttempt,
  FiscalInvoiceStatus,
  FiscalInvoiceSummary,
  FiscalOverview,
  LoginResponse,
  MedicineSearchResult,
  OwnerAnswer,
  OperationalAlertsResponse,
  OwnerTool,
  PurchaseOrderDetail,
  PurchaseOrderStatus,
  PurchaseOrderSummary,
  ReorderSuggestion,
  ReservedSaleDraft,
  ReturnCommandResult,
  ReturnLookup,
  SaleDraftResult,
  SaleReceipt,
  ShelfRecommendation,
  SupplierSummary,
};

const runtimeEnvironment = import.meta.env as unknown as { readonly VITE_API_URL?: string };
const API_URL = runtimeEnvironment.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    if (response.status === 401 && path !== '/auth/login') {
      window.dispatchEvent(new CustomEvent('pharmacy:unauthorized'));
    }
    throw new ApiError(error?.message ?? `Request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

function authenticatedRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
}

export function login(
  username: string,
  password: string,
  terminalCode: string,
): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, terminalCode }),
  });
}

export function logout(token: string): Promise<{ readonly revoked: boolean }> {
  return authenticatedRequest(token, '/auth/logout', { method: 'POST' });
}

export function checkLanHealth(): Promise<{ readonly status: string }> {
  return request('/health/ready', { method: 'GET' });
}

export function getInventoryAttention(token: string): Promise<Record<string, string>> {
  return authenticatedRequest(token, '/inventory-intelligence/attention');
}

export function getFailedJobs(token: string, limit = 20): Promise<FailedJobsResponse> {
  return authenticatedRequest(token, `/operations/jobs/failed?limit=${limit}`);
}

export function getOperationalAlerts(
  token: string,
  limit = 20,
): Promise<OperationalAlertsResponse> {
  return authenticatedRequest(token, `/operations/alerts?status=OPEN&limit=${limit}`);
}

export async function getExpiryRisk(token: string): Promise<ExpiryRiskItem[]> {
  const response = await authenticatedRequest<{ data: ExpiryRiskItem[] }>(
    token,
    '/expiry-risk?limit=50',
  );
  return response.data;
}

export async function getShelfRecommendations(token: string): Promise<ShelfRecommendation[]> {
  const response = await authenticatedRequest<{ data: ShelfRecommendation[] }>(
    token,
    '/shelf-recommendations?limit=50',
  );
  return response.data;
}

export async function getReorderSuggestions(token: string): Promise<ReorderSuggestion[]> {
  const response = await authenticatedRequest<{ data: ReorderSuggestion[] }>(
    token,
    '/reorder-suggestions?limit=50',
  );
  return response.data;
}

export function reviewShelfRecommendation(
  token: string,
  id: string,
  decision: 'APPLY' | 'DISMISS',
) {
  return authenticatedRequest<Record<string, unknown>>(
    token,
    `/shelf-recommendations/${id}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
    },
  );
}

export function reviewReorderSuggestion(token: string, id: string, decision: 'REVIEW' | 'DISMISS') {
  return authenticatedRequest<Record<string, unknown>>(token, `/reorder-suggestions/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

export function calculateBudgetRegimen(
  token: string,
  input: {
    readonly budget: string;
    readonly items: ReadonlyArray<{
      readonly medicineId: string;
      readonly prescribedBaseUnitsPerDay: string;
      readonly minimumSaleIncrement: string;
    }>;
  },
): Promise<BudgetRegimenResult> {
  return authenticatedRequest(token, '/budget-regimen/calculate', {
    method: 'POST',
    body: JSON.stringify({ ...input, persistAudit: false }),
  });
}

export function lookupReturn(token: string, receiptToken: string): Promise<ReturnLookup> {
  return authenticatedRequest(token, `/returns/lookup/${encodeURIComponent(receiptToken)}`);
}

export function requestReturn(
  token: string,
  receiptToken: string,
  input: {
    readonly reason: string;
    readonly items: ReadonlyArray<{
      readonly saleItemId: string;
      readonly quantity: string;
      readonly disposition: 'RESTOCK_SELLABLE' | 'QUARANTINE' | 'SCRAP';
    }>;
  },
): Promise<ReturnCommandResult> {
  return authenticatedRequest(
    token,
    `/returns/lookup/${encodeURIComponent(receiptToken)}/request`,
    {
      method: 'POST',
      body: JSON.stringify({ ...input, clientRequestId: createClientRequestId() }),
    },
  );
}

export function approveReturn(token: string, returnId: string): Promise<ReturnCommandResult> {
  return authenticatedRequest(token, `/returns/${returnId}/approve`, { method: 'POST' });
}

export function refundReturn(
  token: string,
  returnId: string,
  input: { readonly method: 'CASH' | 'CARD' | 'BANK_TRANSFER'; readonly cashSessionId?: string },
): Promise<ReturnCommandResult> {
  return authenticatedRequest(token, `/returns/${returnId}/refund`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function askOwnerAssistant(
  token: string,
  question: string,
  tool: OwnerTool,
): Promise<OwnerAnswer> {
  return authenticatedRequest(token, '/owner-ai/chat', {
    method: 'POST',
    body: JSON.stringify({ question, tool, arguments: {} }),
  });
}

export function getCurrentCashSession(token: string): Promise<CashSessionSummary | null> {
  return authenticatedRequest(token, '/cash-sessions/current');
}

export async function getPendingCashVariances(token: string): Promise<CashSessionSummary[]> {
  const result = await authenticatedRequest<{ data: CashSessionSummary[] }>(
    token,
    '/cash-sessions/pending-variance',
  );
  return result.data;
}

export function openCashSession(token: string, openingFloat: string): Promise<CashSessionSummary> {
  return authenticatedRequest(token, '/cash-sessions/open', {
    method: 'POST',
    body: JSON.stringify({ openingFloat, clientRequestId: createClientRequestId() }),
  });
}

export function addCashMovement(
  token: string,
  sessionId: string,
  input: {
    readonly movementType: 'CASH_IN' | 'CASH_OUT';
    readonly amount: string;
    readonly reason: string;
  },
): Promise<{ readonly session: CashSessionSummary }> {
  return authenticatedRequest(token, `/cash-sessions/${sessionId}/movements`, {
    method: 'POST',
    body: JSON.stringify({ ...input, clientRequestId: createClientRequestId() }),
  });
}

export function closeCashSession(
  token: string,
  sessionId: string,
  countedCash: string,
  closingNotes?: string,
): Promise<CashSessionSummary> {
  return authenticatedRequest(token, `/cash-sessions/${sessionId}/close`, {
    method: 'POST',
    body: JSON.stringify({ countedCash, closingNotes, clientRequestId: createClientRequestId() }),
  });
}

export function approveCashVariance(
  token: string,
  sessionId: string,
  notes: string,
): Promise<CashSessionSummary> {
  return authenticatedRequest(token, `/cash-sessions/${sessionId}/approve-variance`, {
    method: 'POST',
    body: JSON.stringify({ notes, clientRequestId: createClientRequestId() }),
  });
}

export async function searchMedicines(
  token: string,
  query: string,
): Promise<MedicineSearchResult[]> {
  const response = await request<{ data: MedicineSearchResult[] }>(
    `/catalog/medicines/search?query=${encodeURIComponent(query)}&limit=20`,
    { method: 'GET', headers: { authorization: `Bearer ${token}` } },
  );
  return response.data;
}

export function createSaleDraft(
  token: string,
  terminalId: string,
  items: ReadonlyArray<{ readonly medicineId: string; readonly quantity: string }>,
): Promise<SaleDraftResult> {
  return authenticatedRequest(token, '/pos/drafts', {
    method: 'POST',
    body: JSON.stringify({ terminalId, items }),
  });
}

export function reserveSaleDraft(token: string, draftId: string): Promise<ReservedSaleDraft> {
  return authenticatedRequest(token, `/pos/drafts/${draftId}/reserve`, { method: 'POST' });
}

export function finalizeSale(
  token: string,
  cashSessionId: string,
  draftId: string,
  clientRequestId: string,
  payments: readonly SalePaymentInput[],
  customerId?: string,
): Promise<FinalizedSale> {
  return authenticatedRequest(token, '/pos/sales/finalize', {
    method: 'POST',
    body: JSON.stringify({
      cashSessionId,
      draftId,
      clientRequestId,
      payments,
      customerId,
    }),
  });
}

export function applySaleDiscount(
  token: string,
  draftId: string,
  input: {
    readonly invoiceDiscount: string;
    readonly reason: string;
    readonly clientRequestId: string;
    readonly approverUsername?: string;
    readonly approverPassword?: string;
  },
): Promise<{ readonly total: string; readonly approvalLevel: string }> {
  return authenticatedRequest(token, `/pos/drafts/${draftId}/discount`, {
    method: 'POST',
    body: JSON.stringify({ ...input, lineDiscounts: [] }),
  });
}

export async function searchCustomers(token: string, query: string): Promise<CustomerSummary[]> {
  const response = await authenticatedRequest<{ readonly data: CustomerSummary[] }>(
    token,
    `/customers?query=${encodeURIComponent(query)}&limit=20`,
  );
  return response.data;
}

export function createCustomer(
  token: string,
  input: {
    readonly name: string;
    readonly phone?: string;
    readonly address?: string;
    readonly creditLimit: string;
    readonly openingBalance: string;
  },
): Promise<CustomerSummary> {
  return authenticatedRequest(token, '/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getCustomerStatement(
  token: string,
  customerId: string,
): Promise<CustomerStatement> {
  return authenticatedRequest(token, `/customers/${customerId}/statement`);
}

export function recordCustomerPayment(
  token: string,
  customerId: string,
  input: {
    readonly amount: string;
    readonly method: 'CASH' | 'CARD' | 'BANK_TRANSFER';
    readonly cashSessionId?: string;
    readonly reference?: string;
  },
) {
  return authenticatedRequest<{ readonly id: string; readonly balance: string }>(
    token,
    `/customers/${customerId}/payments`,
    {
      method: 'POST',
      body: JSON.stringify({ ...input, clientRequestId: createClientRequestId() }),
    },
  );
}

export function getOwnerDashboard(
  token: string,
  date?: string,
): Promise<{
  readonly data: DashboardSnapshot | null;
  readonly status: 'READY' | 'PENDING_REFRESH';
  readonly dataBasis: string;
}> {
  return authenticatedRequest(token, `/dashboard/owner${date ? `?date=${date}` : ''}`);
}

export interface InventoryBatchSummary {
  readonly id: string;
  readonly medicineId: string;
  readonly medicineName: string;
  readonly batchNumber: string;
  readonly expiryDate: string;
  readonly currentQuantity: string;
  readonly salePrice: string;
  readonly maximumRetailPrice: string | null;
  readonly status: string;
}

export async function searchInventoryBatches(
  token: string,
  query: string,
): Promise<readonly InventoryBatchSummary[]> {
  const response = await authenticatedRequest<{ readonly data: readonly InventoryBatchSummary[] }>(
    token,
    `/inventory/batches?query=${encodeURIComponent(query)}&limit=50`,
  );
  return response.data;
}

export function updateInventoryPrice(
  token: string,
  batchId: string,
  input: {
    readonly salePrice: string;
    readonly maximumRetailPrice?: string | null;
    readonly reason: string;
  },
) {
  return authenticatedRequest<Record<string, unknown>>(
    token,
    `/inventory/batches/${batchId}/price`,
    {
      method: 'POST',
      body: JSON.stringify({ ...input, clientRequestId: createClientRequestId() }),
    },
  );
}

export function adjustInventoryStock(
  token: string,
  batchId: string,
  input:
    | { readonly type: 'COUNT'; readonly countedQuantity: string; readonly reason: string }
    | { readonly type: 'SCRAP'; readonly quantity: string; readonly reason: string },
) {
  return authenticatedRequest<Record<string, unknown>>(
    token,
    `/inventory/batches/${batchId}/adjustments`,
    {
      method: 'POST',
      body: JSON.stringify({ ...input, clientRequestId: createClientRequestId() }),
    },
  );
}

export function adminGet<T>(token: string, path: string): Promise<T> {
  return authenticatedRequest(token, `/admin${path}`);
}

export function adminPost<T>(token: string, path: string, body: unknown): Promise<T> {
  return authenticatedRequest(token, `/admin${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function adminPatch<T>(token: string, path: string, body: unknown): Promise<T> {
  return authenticatedRequest(token, `/admin${path}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function getSaleReceipt(token: string, saleId: string): Promise<SaleReceipt> {
  return authenticatedRequest(token, `/pos/sales/${saleId}/receipt`);
}

export async function findSalesForReceipt(
  token: string,
  query: string,
): Promise<readonly SaleReceiptSearchResult[]> {
  const response = await authenticatedRequest<{ readonly data: SaleReceiptSearchResult[] }>(
    token,
    `/pos/sales?query=${encodeURIComponent(query)}`,
  );
  return response.data;
}

export function reprintSaleReceipt(token: string, saleId: string): Promise<SaleReceipt> {
  return authenticatedRequest(token, `/pos/sales/${saleId}/reprint`, { method: 'POST' });
}

export async function listSuppliers(token: string): Promise<readonly SupplierSummary[]> {
  const response = await authenticatedRequest<{ readonly data: readonly SupplierSummary[] }>(
    token,
    '/admin/suppliers',
  );
  return response.data;
}

export async function listPurchaseOrders(
  token: string,
  status?: PurchaseOrderStatus,
): Promise<readonly PurchaseOrderSummary[]> {
  const query = status ? `?status=${status}&limit=50` : '?limit=50';
  const response = await authenticatedRequest<{ readonly data: readonly PurchaseOrderSummary[] }>(
    token,
    `/purchase-orders${query}`,
  );
  return response.data;
}

export function getPurchaseOrder(
  token: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderDetail> {
  return authenticatedRequest(token, `/purchase-orders/${purchaseOrderId}`);
}

export interface PurchaseOrderDraftLine {
  readonly medicineId: string;
  readonly orderedQuantity: string;
  readonly unitCost: string;
  readonly lineDiscount: string;
  readonly bonusQuantity: string;
  readonly baseUnitsPerOrderUnit: string;
}

export function createPurchaseOrder(
  token: string,
  input: {
    readonly supplierId: string;
    readonly supplierInvoiceNumber?: string;
    readonly items: readonly PurchaseOrderDraftLine[];
  },
  clientRequestId: string,
): Promise<Omit<PurchaseOrderDetail, 'receipts'>> {
  return authenticatedRequest(token, '/purchase-orders', {
    method: 'POST',
    body: JSON.stringify({ ...input, clientRequestId }),
  });
}

export function markPurchaseOrderOrdered(
  token: string,
  purchaseOrderId: string,
  clientRequestId: string,
): Promise<Record<string, unknown>> {
  return authenticatedRequest(token, `/purchase-orders/${purchaseOrderId}/order`, {
    method: 'POST',
    body: JSON.stringify({ clientRequestId }),
  });
}

export interface GoodsReceiptLineInput {
  readonly purchaseOrderItemId: string;
  readonly receivedQuantity: string;
  readonly receivedBonusQuantity: string;
  readonly batchNumber: string;
  readonly expiryDate: string;
  readonly salePricePerBaseUnit: string;
}

export function receivePurchaseOrder(
  token: string,
  purchaseOrderId: string,
  input: {
    readonly supplierInvoiceNumber?: string;
    readonly lines: readonly GoodsReceiptLineInput[];
  },
  clientRequestId: string,
): Promise<Record<string, unknown>> {
  return authenticatedRequest(token, `/purchase-orders/${purchaseOrderId}/receive`, {
    method: 'POST',
    body: JSON.stringify({ ...input, clientRequestId }),
  });
}

export function addSupplierQuote(
  token: string,
  input: {
    readonly supplierId: string;
    readonly medicineId: string;
    readonly quotedUnitCost: string;
    readonly quoteUnit: string;
    readonly baseUnitsPerQuoteUnit: string;
    readonly source: string;
  },
): Promise<Record<string, unknown>> {
  return authenticatedRequest(token, '/supplier-quotes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getDeterministicReport(
  token: string,
  report: DeterministicReportName,
  range: { readonly from?: string; readonly to?: string; readonly limit?: number },
): Promise<DeterministicReport> {
  const parameters = new URLSearchParams();
  if (range.from) parameters.set('from', range.from);
  if (range.to) parameters.set('to', range.to);
  if (range.limit) parameters.set('limit', String(range.limit));
  const query = parameters.toString();
  return authenticatedRequest(token, `/reports/${report}${query ? `?${query}` : ''}`);
}

export function getFiscalOverview(
  token: string,
  status?: FiscalInvoiceStatus,
): Promise<FiscalOverview> {
  const query = status ? `?status=${status}&limit=50` : '?limit=50';
  return authenticatedRequest(token, `/fiscal/invoices${query}`);
}

export function getFiscalAttempts(
  token: string,
  fiscalInvoiceId: string,
): Promise<{
  readonly invoice: FiscalInvoiceSummary;
  readonly attempts: readonly FiscalInvoiceAttempt[];
}> {
  return authenticatedRequest(token, `/fiscal/invoices/${fiscalInvoiceId}/attempts`);
}

export function retryFiscalInvoice(
  token: string,
  fiscalInvoiceId: string,
  reason: string,
  clientRequestId: string,
): Promise<{ readonly id: string; readonly status: string }> {
  return authenticatedRequest(token, `/fiscal/invoices/${fiscalInvoiceId}/retry`, {
    method: 'POST',
    body: JSON.stringify({ reason, clientRequestId }),
  });
}

export function getBackupOverview(token: string): Promise<BackupOverview> {
  return authenticatedRequest(token, '/operations/backups?limit=20');
}

export async function getAiAudits(token: string): Promise<readonly AiAssistantAudit[]> {
  const response = await authenticatedRequest<{ readonly data: readonly AiAssistantAudit[] }>(
    token,
    '/owner-ai/audits?limit=50',
  );
  return response.data;
}

export function importCatalog(
  token: string,
  mode: 'VALIDATE' | 'APPLY',
  rows: readonly Record<string, unknown>[],
  clientRequestId: string,
): Promise<CatalogImportResult> {
  return authenticatedRequest(token, '/admin/medicines/import', {
    method: 'POST',
    body: JSON.stringify({ mode, rows, clientRequestId }),
  });
}
