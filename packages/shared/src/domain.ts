export const SALE_DRAFT_STATUSES = [
  'DRAFT',
  'SENT_TO_CASHIER',
  'RESERVED',
  'PAYMENT_IN_PROGRESS',
  'PAID',
  'CANCELLED',
  'EXPIRED',
] as const;

export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT'] as const;
export const CASH_MOVEMENT_TYPES = ['CASH_IN', 'CASH_OUT'] as const;
export const CASH_SESSION_STATUSES = ['OPEN', 'CLOSING', 'CLOSED', 'VARIANCE_APPROVED'] as const;
export const FBR_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'VALIDATING',
  'VALIDATED',
  'SUBMITTING',
  'SUBMITTED',
  'FAILED_RETRYABLE',
  'FAILED_NEEDS_REVIEW',
  'VOID_OR_CREDIT_NOTE_PENDING',
] as const;

export type SaleDraftStatus = (typeof SALE_DRAFT_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];
export type CashSessionStatus = (typeof CASH_SESSION_STATUSES)[number];
export type FbrStatus = (typeof FBR_STATUSES)[number];

export const PERMISSIONS = {
  POS_SEARCH: 'pos.search',
  POS_CREATE_DRAFT: 'pos.create_draft',
  POS_SEND_TO_CASHIER: 'pos.send_to_cashier',
  SALE_FINALIZE_PAYMENT: 'sale.finalize_payment',
  SALE_DISCOUNT_BASIC: 'sale.discount.basic',
  SALE_DISCOUNT_OVERRIDE: 'sale.discount.override',
  CUSTOMER_READ: 'customer.read',
  CUSTOMER_MANAGE: 'customer.manage',
  CUSTOMER_CREDIT: 'customer.credit',
  CUSTOMER_PAYMENT: 'customer.payment',
  RETURNS_REQUEST: 'returns.request',
  RETURNS_APPROVE: 'returns.approve',
  RETURNS_REFUND_CASH: 'returns.refund_cash',
  INVENTORY_PURCHASE: 'inventory.purchase',
  INVENTORY_ADJUST: 'inventory.adjust',
  REPORTS_VIEW_BASIC: 'reports.view_basic',
  REPORTS_VIEW_FINANCIAL: 'reports.view_financial',
  CASH_OPEN_SESSION: 'cash.open_session',
  CASH_CLOSE_SESSION: 'cash.close_session',
  CASH_APPROVE_VARIANCE: 'cash.approve_variance',
  FBR_VIEW_STATUS: 'fbr.view_status',
  FBR_RETRY: 'fbr.retry',
  SETTINGS_MANAGE_USERS: 'settings.manage_users',
  SETTINGS_MANAGE_SYSTEM: 'settings.manage_system',
  BACKUP_RESTORE: 'backup.restore',
  INVENTORY_SHELF_READ: 'inventory.shelf.read',
  INVENTORY_SHELF_MANAGE: 'inventory.shelf.manage',
  INVENTORY_SHELF_REVIEW: 'inventory.shelf.recommendation.review',
  INVENTORY_EXPIRY_READ: 'inventory.expiry.read',
  INVENTORY_EXPIRY_MANAGE: 'inventory.expiry.manage',
  PROCUREMENT_SUPPLIER_PRICE_READ: 'procurement.supplier_price.read',
  PROCUREMENT_REORDER_REVIEW: 'procurement.reorder.review',
  PROCUREMENT_PURCHASE_DRAFT_APPROVE: 'procurement.purchase_draft.approve',
  SALES_BUDGET_REGIMEN_CALCULATE: 'sales.budget_regimen.calculate',
  SALES_BUDGET_REGIMEN_VERIFY: 'sales.budget_regimen.verify',
  RETURNS_LOOKUP: 'returns.lookup',
  RETURNS_REFUND: 'returns.refund',
  ANALYTICS_OWNER_READ: 'analytics.owner.read',
  AI_OWNER_USE: 'ai.owner.use',
  AI_AUDIT_READ: 'ai.audit.read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
