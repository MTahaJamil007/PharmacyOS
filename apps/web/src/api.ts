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
  type FeatureKey,
  type FeatureSetting,
  type FiscalOverview,
  type AlphabetPlacement,
  type PlanCode,
  type ResolvedFeatures,
  type ScannedCode,
  type FixtureChange,
  type FixtureLayout,
  type FloorPlan,
  type LayoutIssue,
  type LoginResponse,
  type MoveReason,
  type PlacementGrouping,
  type PlanMode,
  type SlotRef,
  type UnplacedReason,
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

interface ErrorBody {
  readonly message?: unknown;
  readonly formErrors?: unknown;
  readonly fieldErrors?: unknown;
}

function messageList(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Turns a rejected response into something an operator can act on. A validated endpoint answers
 * with Zod's flattened field errors and no `message`, so reporting only `message` would hide the
 * one thing the operator needs to change.
 */
export function describeApiError(body: ErrorBody | null, status: number): string {
  const fieldErrors =
    typeof body?.fieldErrors === 'object' && body.fieldErrors !== null
      ? (body.fieldErrors as Record<string, unknown>)
      : {};
  const details = [
    ...messageList(body?.formErrors),
    ...Object.entries(fieldErrors).flatMap(([field, messages]) =>
      messageList(messages).map((message) => `${field}: ${message}`),
    ),
  ];
  if (details.length > 0) return details.join('; ');
  const message = messageList(body?.message);
  return message.length > 0 ? message.join('; ') : `Request failed (${status})`;
}

async function request<T>(
  path: string,
  init: RequestInit,
  announceUnauthorized = true,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(
      `Cannot reach the pharmacy service at ${API_URL}. Check that it is running.`,
      0,
    );
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ErrorBody | null;
    if (response.status === 401 && path !== '/auth/login' && announceUnauthorized) {
      window.dispatchEvent(new CustomEvent('pharmacy:unauthorized'));
    }
    throw new ApiError(describeApiError(error, response.status), response.status);
  }
  return response.json() as Promise<T>;
}

function authenticatedRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
}

export interface TerminalPreference {
  /** Binds the session to exactly this terminal; sign-in fails when it cannot be used. */
  readonly terminalCode?: string;
  /** Terminal this device opened last; the server chooses another when it no longer applies. */
  readonly preferredTerminalCode?: string;
}

export function login(
  username: string,
  password: string,
  terminal: TerminalPreference = {},
): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, ...terminal }),
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

export interface CounterSettings {
  readonly cashSessionsEnabled: boolean;
}

export function getCounterSettings(token: string): Promise<CounterSettings> {
  return authenticatedRequest(token, '/pos/counter-settings');
}

/** Hands a reserved order to the cash counter queue (cash sessions on). */
export function sendToCashCounter(
  token: string,
  draftId: string,
  customerId?: string,
  cashCounterTerminalId?: string,
): Promise<{ readonly id: string; readonly total: string }> {
  return authenticatedRequest(token, `/pos/drafts/${draftId}/send-to-cashier`, {
    method: 'POST',
    body: JSON.stringify({
      ...(customerId ? { customerId } : {}),
      ...(cashCounterTerminalId ? { cashCounterTerminalId } : {}),
    }),
  });
}

/** Issues the invoice straight from the order desk (cash sessions off). */
export function completeCounterInvoice(
  token: string,
  draftId: string,
  clientRequestId: string,
  customerId?: string,
): Promise<FinalizedSale> {
  return authenticatedRequest(token, `/pos/drafts/${draftId}/complete-invoice`, {
    method: 'POST',
    body: JSON.stringify({ clientRequestId, ...(customerId ? { customerId } : {}) }),
  });
}

export interface CashCounterOrder {
  readonly id: string;
  readonly total: string;
  readonly invoiceDiscount: string;
  readonly queuedAt: string;
  readonly reservedUntil: string | null;
  readonly status: string;
  readonly orderTaker: string;
  readonly counterName: string;
  readonly customerName: string | null;
  /** The cash counter the order desk chose, or null for any counter. */
  readonly cashCounterId?: string | null;
  readonly cashCounterName?: string | null;
  readonly forThisCounter?: boolean | null;
  /** Another counter is taking this payment right now. */
  readonly claimedBy?: string | null;
  readonly claimedHere?: boolean | null;
  readonly items: ReadonlyArray<{
    readonly name: string;
    readonly strength: string | null;
    readonly quantity: string;
    readonly lineTotal: string;
    readonly dosage: string | null;
  }>;
}

export interface CashCounterQueue {
  readonly data: readonly CashCounterOrder[];
  readonly recent: ReadonlyArray<{
    readonly id: string;
    readonly invoiceNumber: string;
    readonly total: string;
    readonly createdAt: string;
  }>;
}

export function getCashCounterQueue(token: string): Promise<CashCounterQueue> {
  return authenticatedRequest(token, '/pos/cash-counter/queue');
}

export function clearCashCounterPayment(
  token: string,
  draftId: string,
  input: {
    readonly cashSessionId: string;
    readonly clientRequestId: string;
    readonly tenderedAmount?: string;
  },
): Promise<FinalizedSale> {
  return authenticatedRequest(token, `/pos/cash-counter/${draftId}/clear`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelCashCounterOrder(token: string, draftId: string): Promise<unknown> {
  return authenticatedRequest(token, `/pos/cash-counter/${draftId}/cancel`, { method: 'POST' });
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
  items: ReadonlyArray<{
    readonly medicineId: string;
    readonly quantity: string;
    readonly dosageInstruction?: string;
  }>,
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
    readonly lineDiscounts: ReadonlyArray<{ readonly medicineId: string; readonly amount: string }>;
    readonly invoiceDiscount: string;
    readonly reason: string;
    readonly clientRequestId: string;
    readonly approverUsername?: string;
    readonly approverPassword?: string;
  },
): Promise<{ readonly total: string; readonly approvalLevel: string }> {
  return authenticatedRequest(token, `/pos/drafts/${draftId}/discount`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelSaleDraft(
  token: string,
  draftId: string,
): Promise<{ readonly id: string; readonly status: 'CANCELLED' }> {
  return authenticatedRequest(token, `/pos/drafts/${draftId}/cancel`, { method: 'POST' });
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

export function adminPut<T>(token: string, path: string, body: unknown): Promise<T> {
  return authenticatedRequest(token, `/admin${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** Software-owner (super admin) endpoints. */
export function platformRequest<T>(
  token: string,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown,
): Promise<T> {
  return authenticatedRequest(token, `/platform${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Sends raw ESC/POS bytes, base64 encoded, to a LAN receipt printer through the local API. */
export function printToNetworkPrinter(
  token: string,
  input: { readonly host: string; readonly port: number; readonly data: string },
): Promise<{ readonly bytes: number }> {
  return authenticatedRequest(token, '/printing/network', {
    method: 'POST',
    body: JSON.stringify(input),
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

export interface PlannerLevel {
  readonly level: number;
  readonly shelfId: string;
  readonly code: string;
  /** A short name staff use for the level, such as "Antibiotic syrups". */
  readonly label?: string | null;
  readonly used: number;
}

export interface PlannerFixture extends FixtureLayout {
  readonly id: string | null;
  readonly levels: readonly PlannerLevel[];
}

export interface ShelfPlannerState {
  readonly version: number;
  readonly floor: FloorPlan | null;
  readonly fixtures: readonly PlannerFixture[];
  readonly otherShelves: ReadonlyArray<{ id: string; code: string; name: string; used: number }>;
  readonly stats: { readonly stocked: number; readonly placed: number; readonly unplaced: number };
  readonly pendingProposal: { readonly id: string; readonly createdAt: string } | null;
  readonly lookbackDays: number;
}

export interface PlannerMedicine {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly company: string | null;
  readonly stock?: string;
  readonly storageClass?: string;
  readonly requiresSecured?: boolean;
  readonly shelfCode?: string | null;
  readonly shelfId?: string | null;
}

export interface ProposalMove {
  readonly medicineId: string;
  readonly name: string;
  readonly group: string;
  readonly picksPerMonth: number;
  readonly from: SlotRef | null;
  readonly fromLabel: string | null;
  readonly to: SlotRef;
  readonly toLabel: string;
  readonly reason: MoveReason;
  readonly secondsSavedPerMonth: number;
}

export interface ShelfProposal {
  readonly id: string;
  readonly status: string;
  readonly layoutVersion: number;
  readonly createdAt: string;
  readonly summary: {
    readonly mode: PlanMode;
    readonly grouping: PlacementGrouping;
    readonly lookbackDays: number;
    readonly medicinesConsidered: number;
    readonly withSales: number;
    readonly moveCount: number;
    readonly newPlacements: number;
    readonly fixtureChangeCount: number;
    readonly unplacedCount: number;
    readonly secondsSavedPerMonth: number;
  };
  readonly fixtureChanges: readonly FixtureChange[];
  readonly fixtures: readonly FixtureLayout[];
  readonly moves: readonly ProposalMove[];
  readonly unplaced: ReadonlyArray<{
    readonly medicineId: string;
    readonly name: string;
    readonly group: string;
    readonly reason: UnplacedReason;
  }>;
}

export interface SaveLayoutFixture extends FixtureLayout {
  readonly id: string | null;
}

export function getShelfPlanner(token: string): Promise<ShelfPlannerState> {
  return authenticatedRequest(token, '/shelf-planner');
}

export function saveShelfLayout(
  token: string,
  expectedVersion: number,
  floor: FloorPlan,
  fixtures: readonly SaveLayoutFixture[],
): Promise<{ readonly version: number; readonly warnings: readonly LayoutIssue[] }> {
  return authenticatedRequest(token, '/shelf-planner/layout', {
    method: 'PUT',
    body: JSON.stringify({
      expectedVersion,
      floor,
      fixtures: fixtures.map((fixture) => ({
        id: fixture.id,
        key: fixture.key,
        code: fixture.code,
        name: fixture.name,
        kind: fixture.kind,
        xCm: Math.round(fixture.xCm),
        yCm: Math.round(fixture.yCm),
        widthCm: fixture.widthCm,
        depthCm: fixture.depthCm,
        rotation: fixture.rotation,
        heightCm: fixture.heightCm,
        levelCount: fixture.levelCount,
        facingsPerLevel: fixture.facingsPerLevel,
        storageClass: fixture.storageClass,
        isSecured: fixture.isSecured,
      })),
    }),
  });
}

export async function getShelfMedicines(
  token: string,
  shelfId: string,
): Promise<readonly PlannerMedicine[]> {
  const response = await authenticatedRequest<{ readonly data: readonly PlannerMedicine[] }>(
    token,
    `/shelf-planner/shelves/${encodeURIComponent(shelfId)}/medicines`,
  );
  return response.data;
}

export async function searchPlannerMedicines(
  token: string,
  query: string,
): Promise<readonly PlannerMedicine[]> {
  const response = await authenticatedRequest<{ readonly data: readonly PlannerMedicine[] }>(
    token,
    `/shelf-planner/medicines?query=${encodeURIComponent(query)}`,
  );
  return response.data;
}

export function placeMedicineOnShelf(
  token: string,
  medicineId: string,
  shelfId: string,
): Promise<{ readonly code: string }> {
  return authenticatedRequest(token, '/shelf-planner/placements', {
    method: 'POST',
    body: JSON.stringify({ medicineId, shelfId }),
  });
}

export function removeMedicineFromShelf(token: string, medicineId: string): Promise<unknown> {
  return authenticatedRequest(token, '/shelf-planner/placements/remove', {
    method: 'POST',
    body: JSON.stringify({ medicineId }),
  });
}

export async function getCurrentShelfProposal(token: string): Promise<ShelfProposal | null> {
  const response = await authenticatedRequest<{ readonly data: ShelfProposal | null }>(
    token,
    '/shelf-planner/proposals/current',
  );
  return response.data;
}

export async function createShelfProposal(
  token: string,
  mode: PlanMode,
  grouping: PlacementGrouping,
): Promise<ShelfProposal> {
  const response = await authenticatedRequest<{ readonly data: ShelfProposal }>(
    token,
    '/shelf-planner/proposals',
    { method: 'POST', body: JSON.stringify({ mode, grouping }) },
  );
  return response.data;
}

export function applyShelfProposal(
  token: string,
  proposalId: string,
  fixtureChangeIds: readonly string[],
  moves: ReadonlyArray<{ medicineId: string; fixtureKey: string; level: number }>,
): Promise<{ readonly fixtureChanges: number; readonly moves: number; readonly version: number }> {
  return authenticatedRequest(
    token,
    `/shelf-planner/proposals/${encodeURIComponent(proposalId)}/apply`,
    {
      method: 'POST',
      body: JSON.stringify({ fixtureChangeIds, moves }),
    },
  );
}

export function rejectShelfProposal(token: string, proposalId: string): Promise<unknown> {
  return authenticatedRequest(
    token,
    `/shelf-planner/proposals/${encodeURIComponent(proposalId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export interface ShopFeaturesResponse {
  readonly plan: PlanCode;
  readonly features: ResolvedFeatures;
}

/** Quiet on 401: a background check must not open the sign-in prompt by itself. */
export function getShopFeatures(token: string): Promise<ShopFeaturesResponse> {
  return request('/features', { headers: { authorization: `Bearer ${token}` } }, false);
}

export interface FeatureCatalogEntry {
  readonly key: FeatureKey;
  readonly group: string;
  readonly label: string;
  readonly description: string;
  readonly plans: readonly PlanCode[];
  readonly settingFields: readonly FeatureSetting[];
  readonly enabled: boolean;
  readonly overridden: boolean;
  readonly settings: Readonly<Record<string, number | boolean>>;
}

export interface FeatureCatalog {
  readonly plan: PlanCode;
  readonly planLabel: string;
  readonly features: readonly FeatureCatalogEntry[];
}

export function getFeatureCatalog(token: string): Promise<FeatureCatalog> {
  return authenticatedRequest(token, '/features/catalog');
}

export function updateFeatureSettings(
  token: string,
  key: FeatureKey,
  settings: Readonly<Record<string, number | boolean>>,
): Promise<FeatureCatalog> {
  return authenticatedRequest(token, `/features/${key}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({ settings }),
  });
}

export function getShopFeatureCatalog(token: string, shopId: string): Promise<FeatureCatalog> {
  return authenticatedRequest(token, `/platform/shops/${encodeURIComponent(shopId)}/features`);
}

export function setShopPlan(
  token: string,
  shopId: string,
  plan: PlanCode,
): Promise<FeatureCatalog> {
  return authenticatedRequest(token, `/platform/shops/${encodeURIComponent(shopId)}/plan`, {
    method: 'PUT',
    body: JSON.stringify({ plan }),
  });
}

export function setShopFeature(
  token: string,
  shopId: string,
  key: FeatureKey,
  change: {
    readonly enabled?: boolean | null;
    readonly settings?: Readonly<Record<string, number | boolean>>;
  },
): Promise<FeatureCatalog> {
  return authenticatedRequest(
    token,
    `/platform/shops/${encodeURIComponent(shopId)}/features/${key}`,
    { method: 'PATCH', body: JSON.stringify(change) },
  );
}

export interface SubstituteResponse {
  readonly formulation: string | null;
  readonly data: readonly MedicineSearchResult[];
}

export function getSubstitutes(token: string, medicineId: string): Promise<SubstituteResponse> {
  return authenticatedRequest(
    token,
    `/catalog/medicines/${encodeURIComponent(medicineId)}/substitutes`,
  );
}

export function recordCustomerRequest(
  token: string,
  input: { readonly medicineId?: string; readonly requestedName: string },
): Promise<{ readonly id: string; readonly counted: boolean }> {
  return authenticatedRequest(token, '/stock/customer-requests', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface ScannedMedicine {
  readonly id: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly packSize: string;
  readonly unitName: string;
  readonly storageClass: string;
  readonly requiresSecured: boolean;
  readonly requiresPrescription: boolean;
}

export interface ReceivingDefaults {
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly costPerPack: string | null;
  readonly unitsPerPack: string;
  readonly salePricePerUnit: string | null;
  readonly lastReceivedAt: string | null;
}

export interface ScanResult {
  readonly scan: ScannedCode;
  readonly medicine: ScannedMedicine | null;
  readonly defaults: ReceivingDefaults | null;
  readonly existingBatch: {
    readonly quantity: string;
    readonly expiryDate: string;
    readonly salePrice: string;
  } | null;
  readonly warnings: readonly string[];
}

export function scanForReceiving(token: string, code: string): Promise<ScanResult> {
  return authenticatedRequest(token, `/stock/scan?code=${encodeURIComponent(code)}`);
}

export function getReceivingMedicine(
  token: string,
  medicineId: string,
): Promise<{ readonly medicine: ScannedMedicine; readonly defaults: ReceivingDefaults }> {
  return authenticatedRequest(
    token,
    `/stock/receiving/medicines/${encodeURIComponent(medicineId)}`,
  );
}

export function linkBarcode(
  token: string,
  medicineId: string,
  code: string,
): Promise<{ readonly barcode: string; readonly alreadyLinked: boolean }> {
  return authenticatedRequest(token, '/stock/barcodes', {
    method: 'POST',
    body: JSON.stringify({ medicineId, code }),
  });
}

export interface QuickReceiptLine {
  readonly medicineId: string;
  readonly quantity: string;
  readonly bonusQuantity: string;
  readonly unitsPerPack: string;
  readonly costPerPack: string;
  readonly lineDiscount: string;
  readonly batchNumber: string;
  readonly expiryDate: string;
  readonly salePricePerUnit: string;
  readonly scannedCode?: string;
}

export function submitQuickReceipt(
  token: string,
  input: {
    readonly clientRequestId: string;
    readonly supplierId: string;
    readonly supplierInvoiceNumber?: string;
    readonly lines: readonly QuickReceiptLine[];
  },
): Promise<{
  readonly receiptId: string;
  readonly purchaseOrderId: string;
  readonly orderNumber?: string;
  readonly totalCost: string;
  readonly lineCount: number;
  readonly shelves?: ReadonlyArray<{ readonly medicineId: string; readonly shelf: string | null }>;
  readonly idempotentReplay: boolean;
}> {
  return authenticatedRequest(token, '/quick-receipts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface LowStockRow {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly packSize: string;
  readonly onHand: string;
  readonly dailySales: string;
  readonly daysLeft: number | null;
  readonly minimumStock: string | null;
  readonly suggestedPacks: number;
}

export interface StuckStockRow {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly quantity: string;
  readonly value: string;
  readonly nearestExpiry: string;
  readonly lastSoldAt: string | null;
  readonly inStockSince: string;
}

export interface ExpiringRow {
  readonly batchId: string;
  readonly medicineId: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly batchNumber: string;
  readonly expiryDate: string;
  readonly daysLeft: number;
  readonly quantity: string;
  readonly value: string;
  readonly shelf: string | null;
}

export interface CustomerRequestRow {
  readonly medicineId: string | null;
  readonly requestedName: string;
  readonly times: number;
  readonly lastAsked: string;
  readonly quantity: string | null;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly onHand: string;
}

export function getLowStock(token: string): Promise<{
  readonly lookbackDays: number;
  readonly coverDays: number;
  readonly data: readonly LowStockRow[];
}> {
  return authenticatedRequest(token, '/stock/low');
}

export function getStuckStock(
  token: string,
): Promise<{ readonly days: number; readonly data: readonly StuckStockRow[] }> {
  return authenticatedRequest(token, '/stock/stuck');
}

export function getExpiringStock(
  token: string,
): Promise<{ readonly days: number; readonly data: readonly ExpiringRow[] }> {
  return authenticatedRequest(token, '/stock/expiring');
}

export function getCustomerRequests(token: string): Promise<{
  readonly days: number;
  readonly minimum: number;
  readonly data: readonly CustomerRequestRow[];
}> {
  return authenticatedRequest(token, '/stock/customer-requests');
}

export interface OrderListLine {
  readonly medicineId: string;
  readonly name: string;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly manufacturer: string | null;
  readonly onHand: string;
  readonly daysLeft: number | null;
  readonly suggestedPacks: number;
  readonly requestCount: number;
  readonly reasons: ReadonlyArray<'LOW_STOCK' | 'CUSTOMER_REQUESTS'>;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly costPerPack: string | null;
  readonly unitsPerPack: string | null;
}

export function getOrderList(token: string): Promise<{
  readonly lines: readonly OrderListLine[];
  readonly notInCatalog: ReadonlyArray<{ readonly requestedName: string; readonly times: number }>;
}> {
  return authenticatedRequest(token, '/stock/order-list');
}

export interface CashCounterOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly cashier: string | null;
  readonly waiting: number;
}

export async function getCashCounters(token: string): Promise<readonly CashCounterOption[]> {
  const response = await authenticatedRequest<{ readonly data: readonly CashCounterOption[] }>(
    token,
    '/pos/cash-counters',
  );
  return response.data;
}

export function claimCashCounterBill(token: string, draftId: string): Promise<unknown> {
  return authenticatedRequest(token, `/pos/cash-counter/${encodeURIComponent(draftId)}/claim`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function setShelfLabel(
  token: string,
  shelfId: string,
  label: string | null,
): Promise<unknown> {
  return authenticatedRequest(
    token,
    `/shelf-planner/shelves/${encodeURIComponent(shelfId)}/label`,
    {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    },
  );
}

export interface AlphabetRangeRow {
  readonly slot: SlotRef;
  readonly label: string;
  readonly first: string | null;
  readonly last: string | null;
  readonly count: number;
  readonly capacity: number;
  readonly shelfId: string;
  readonly shelfLabel: string | null;
}

export async function getAlphabetRanges(token: string): Promise<readonly AlphabetRangeRow[]> {
  const response = await authenticatedRequest<{ readonly data: readonly AlphabetRangeRow[] }>(
    token,
    '/shelf-planner/alphabet',
  );
  return response.data;
}

export function placeInAlphabet(
  token: string,
  medicineId: string,
  apply: boolean,
): Promise<AlphabetPlacement & { readonly applied: boolean }> {
  return authenticatedRequest(token, '/shelf-planner/alphabet/place', {
    method: 'POST',
    body: JSON.stringify({ medicineId, apply }),
  });
}
