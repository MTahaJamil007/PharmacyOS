import { createClientRequestId } from '@pharmacy/shared';

export interface LoginResponse {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly user: {
    readonly displayName: string;
    readonly terminalId: string;
    readonly branchId: string;
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

const runtimeEnvironment = import.meta.env as unknown as { readonly VITE_API_URL?: string };
const API_URL = runtimeEnvironment.VITE_API_URL ?? 'http://localhost:3000/api/v1';

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `Request failed (${response.status})`);
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

export function getInventoryAttention(token: string): Promise<Record<string, string>> {
  return authenticatedRequest(token, '/inventory-intelligence/attention');
}

export function getFailedJobs(token: string, limit = 20): Promise<FailedJobsResponse> {
  return authenticatedRequest(token, `/operations/jobs/failed?limit=${limit}`);
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

export interface BudgetRegimenResult {
  readonly completeDays: number;
  readonly totalCost: string;
  readonly remainder: string;
  readonly oneDayCost: string;
  readonly safetyMessage: string;
  readonly lines: ReadonlyArray<{
    readonly medicineId: string;
    readonly medicineName: string;
    readonly requiredQuantity: string;
    readonly lineCost: string;
  }>;
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

export function lookupReturn(token: string, receiptToken: string): Promise<ReturnLookup> {
  return authenticatedRequest(token, `/returns/lookup/${encodeURIComponent(receiptToken)}`);
}

export interface ReturnCommandResult {
  readonly id: string;
  readonly returnNumber?: string;
  readonly status: string;
  readonly refundAmount?: string;
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

export interface CashSessionSummary {
  readonly id: string;
  readonly status: 'OPEN' | 'CLOSING' | 'CLOSED' | 'VARIANCE_APPROVED';
  readonly cashierUserId: string;
  readonly cashierName: string;
  readonly openingFloat: string;
  readonly cashSales: string;
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

export interface SaleDraftResult {
  readonly id: string;
  readonly status: string;
  readonly total: string;
}

export interface FinalizedSale {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly total: string;
  readonly fiscalStatus: string;
  readonly returnLookupToken: string;
  readonly returnLookupPath: string;
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
  readonly payments: ReadonlyArray<{
    readonly method: string;
    readonly amount: string;
    readonly reference: string | null;
  }>;
  readonly returnQrPayload: string;
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

export function reserveSaleDraft(token: string, draftId: string): Promise<Record<string, unknown>> {
  return authenticatedRequest(token, `/pos/drafts/${draftId}/reserve`, { method: 'POST' });
}

export function finalizeCashSale(
  token: string,
  cashSessionId: string,
  draftId: string,
  amount: string,
): Promise<FinalizedSale> {
  return authenticatedRequest(token, '/pos/sales/finalize', {
    method: 'POST',
    body: JSON.stringify({
      cashSessionId,
      draftId,
      clientRequestId: createClientRequestId(),
      payments: [{ method: 'CASH', amount }],
    }),
  });
}

export function getSaleReceipt(token: string, saleId: string): Promise<SaleReceipt> {
  return authenticatedRequest(token, `/pos/sales/${saleId}/receipt`);
}
