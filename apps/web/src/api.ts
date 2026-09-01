import {
  createClientRequestId,
  type BudgetRegimenResult,
  type CashSessionSummary,
  type CustomerStatement,
  type CustomerSummary,
  type DashboardSnapshot,
  type ExpiryRiskItem,
  type FailedJobsResponse,
  type FinalizedSale,
  type LoginResponse,
  type MedicineSearchResult,
  type OwnerAnswer,
  type OperationalAlertsResponse,
  type OwnerTool,
  type ReorderSuggestion,
  type ReservedSaleDraft,
  type ReturnCommandResult,
  type ReturnLookup,
  type SaleDraftResult,
  type SalePaymentInput,
  type SaleReceipt,
  type SaleReceiptSearchResult,
  type ShelfRecommendation,
} from '@pharmacy/shared';

export type {
  BudgetRegimenResult,
  CashSessionSummary,
  CustomerStatement,
  CustomerSummary,
  DashboardSnapshot,
  ExpiryRiskItem,
  FailedJobsResponse,
  FinalizedSale,
  LoginResponse,
  MedicineSearchResult,
  OwnerAnswer,
  OperationalAlertsResponse,
  OwnerTool,
  ReorderSuggestion,
  ReservedSaleDraft,
  ReturnCommandResult,
  ReturnLookup,
  SaleDraftResult,
  SaleReceipt,
  ShelfRecommendation,
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
