import { z } from 'zod';

import { decimalToScaledInteger } from './decimal.js';
import { PAYMENT_METHODS } from './domain.js';
import { moneyToMinorUnits } from './money.js';

const MAX_DATABASE_ID = 9_223_372_036_854_775_807n;
const MAX_MONEY_MINOR_UNITS = 999_999_999_999n;
const MAX_QUANTITY_MILLI_UNITS = 999_999_999_999n;

export const idSchema = z.coerce.bigint().positive().max(MAX_DATABASE_ID);
export const quantitySchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,3})?$/)
  .refine(
    (value) => decimalToScaledInteger(value, 3) <= MAX_QUANTITY_MILLI_UNITS,
    'Quantity exceeds the database limit',
  );
export const positiveQuantitySchema = quantitySchema.refine(
  (value) => decimalToScaledInteger(value, 3) > 0n,
  'Quantity must be greater than zero',
);
export const moneySchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,2})?$/)
  .refine(
    (value) => moneyToMinorUnits(value) <= MAX_MONEY_MINOR_UNITS,
    'Money exceeds the database limit',
  );
export const positiveMoneySchema = moneySchema.refine(
  (value) => moneyToMinorUnits(value) > 0n,
  'Amount must be greater than zero',
);
export const clientRequestIdSchema = z.string().trim().min(8).max(128);

export const loginSchema = z.object({
  username: z.string().trim().min(3).max(100),
  password: z.string().min(8).max(256),
  terminalCode: z.string().trim().min(2).max(64),
});

export const medicineSearchSchema = z.object({
  query: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createDraftSchema = z.object({
  terminalId: idSchema,
  items: z
    .array(
      z.object({
        medicineId: idSchema,
        quantity: positiveQuantitySchema,
      }),
    )
    .min(1)
    .max(100),
});

export const finalizeSaleSchema = z.object({
  draftId: idSchema,
  cashSessionId: idSchema,
  clientRequestId: clientRequestIdSchema,
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: positiveMoneySchema,
        reference: z.string().trim().max(120).optional(),
      }),
    )
    .min(1)
    .max(5),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const shelfRecommendationQuerySchema = paginationSchema.extend({
  status: z
    .enum(['PENDING_REVIEW', 'APPLIED', 'DISMISSED', 'SUPERSEDED'])
    .default('PENDING_REVIEW'),
});

export const shelfRecommendationReviewSchema = z.object({
  decision: z.enum(['APPLY', 'DISMISS']),
  notes: z.string().trim().max(500).optional(),
});

export const expiryRiskQuerySchema = paginationSchema.extend({
  bucket: z.enum(['EXPIRED', 'DAYS_0_30', 'DAYS_31_60', 'DAYS_61_90']).optional(),
});

export const expiryWorkItemActionSchema = z.object({
  action: z.enum(['REVIEWED', 'SUPPLIER_RETURN_CANDIDATE', 'QUARANTINED', 'SCRAPPED', 'RESOLVED']),
  notes: z.string().trim().min(2).max(500),
});

export const supplierQuoteSchema = z
  .object({
    supplierId: idSchema,
    medicineId: idSchema,
    quotedUnitCost: moneySchema,
    quoteUnit: z.string().trim().min(1).max(40),
    baseUnitsPerQuoteUnit: positiveQuantitySchema,
    minimumOrderQuantity: quantitySchema.default('0'),
    validFrom: z.iso.date().optional(),
    validUntil: z.iso.date().optional(),
    source: z.string().trim().min(2).max(160),
  })
  .refine((quote) => !quote.validFrom || !quote.validUntil || quote.validFrom <= quote.validUntil, {
    message: 'validUntil must be on or after validFrom',
    path: ['validUntil'],
  });

export const reorderSuggestionQuerySchema = paginationSchema.extend({
  status: z
    .enum(['GENERATED', 'REVIEWED', 'DRAFT_PO', 'APPROVED', 'ORDERED', 'DISMISSED'])
    .optional(),
});

export const purchaseOrderQuerySchema = paginationSchema.extend({
  status: z.enum(['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(),
});

export const createDraftPurchaseOrderSchema = z.object({
  supplierId: idSchema.optional(),
  quantity: positiveQuantitySchema.optional(),
  clientRequestId: clientRequestIdSchema,
});

export const createPurchaseOrderSchema = z.object({
  supplierId: idSchema,
  supplierInvoiceNumber: z.string().trim().min(1).max(120).optional(),
  clientRequestId: clientRequestIdSchema,
  items: z
    .array(
      z.object({
        medicineId: idSchema,
        orderedQuantity: positiveQuantitySchema,
        unitCost: moneySchema,
        lineDiscount: moneySchema.default('0'),
        bonusQuantity: quantitySchema.default('0'),
        baseUnitsPerOrderUnit: positiveQuantitySchema.default('1'),
      }),
    )
    .min(1)
    .max(500),
});

export const orderPurchaseOrderSchema = z.object({
  clientRequestId: clientRequestIdSchema,
});

export const receivePurchaseOrderSchema = z.object({
  clientRequestId: clientRequestIdSchema,
  supplierInvoiceNumber: z.string().trim().min(1).max(120).optional(),
  lines: z
    .array(
      z.object({
        purchaseOrderItemId: idSchema,
        receivedQuantity: positiveQuantitySchema,
        receivedBonusQuantity: quantitySchema.default('0'),
        batchNumber: z.string().trim().min(1).max(120),
        expiryDate: z.iso.date(),
        salePricePerBaseUnit: moneySchema,
      }),
    )
    .min(1)
    .max(500),
});

export const reviewReorderSuggestionSchema = z.object({
  decision: z.enum(['REVIEW', 'DISMISS']),
  notes: z.string().trim().max(500).optional(),
});

export const budgetRegimenSchema = z.object({
  budget: moneySchema,
  verifiedByUserId: idSchema.optional(),
  persistAudit: z.boolean().default(false),
  items: z
    .array(
      z.object({
        medicineId: idSchema,
        prescribedBaseUnitsPerDay: positiveQuantitySchema,
        minimumSaleIncrement: positiveQuantitySchema.default('1'),
      }),
    )
    .min(1)
    .max(20),
});

export const returnLookupTokenSchema = z.uuid();

export const createReturnSchema = z.object({
  clientRequestId: z.string().trim().min(8).max(128),
  reason: z.string().trim().min(3).max(500),
  items: z
    .array(
      z.object({
        saleItemId: idSchema,
        quantity: positiveQuantitySchema,
        disposition: z.enum(['RESTOCK_SELLABLE', 'QUARANTINE', 'SCRAP']),
      }),
    )
    .min(1)
    .max(100),
});

export const refundReturnSchema = z.object({
  cashSessionId: idSchema.optional(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
});

export const ownerAiToolSchema = z.enum([
  'get_sales_summary',
  'get_profit_summary',
  'get_low_stock',
  'get_expiry_risk',
  'get_purchase_suggestions',
  'get_supplier_price_comparison',
  'get_shelf_recommendations',
  'get_returns_summary',
  'get_cash_reconciliation_summary',
]);

export const ownerAiChatSchema = z.object({
  question: z.string().trim().min(3).max(500),
  tool: ownerAiToolSchema,
  arguments: z
    .object({
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
      medicineId: idSchema.optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    })
    .strict()
    .refine(
      (arguments_) => !arguments_.from || !arguments_.to || arguments_.from <= arguments_.to,
      {
        message: 'to must be on or after from',
        path: ['to'],
      },
    )
    .default({}),
});

export const openCashSessionSchema = z.object({
  openingFloat: moneySchema,
  clientRequestId: clientRequestIdSchema,
});

export const cashMovementSchema = z.object({
  movementType: z.enum(['CASH_IN', 'CASH_OUT']),
  amount: positiveMoneySchema,
  reason: z.string().trim().min(3).max(500),
  clientRequestId: clientRequestIdSchema,
});

export const closeCashSessionSchema = z.object({
  countedCash: moneySchema,
  closingNotes: z.string().trim().max(1000).optional(),
  clientRequestId: clientRequestIdSchema,
});

export const approveCashVarianceSchema = z.object({
  notes: z.string().trim().min(3).max(1000),
  clientRequestId: clientRequestIdSchema,
});

export const failedJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type LoginRequest = z.infer<typeof loginSchema>;
export type CreateDraftRequest = z.infer<typeof createDraftSchema>;
export type FinalizeSaleRequest = z.infer<typeof finalizeSaleSchema>;
export type ShelfRecommendationReviewRequest = z.infer<typeof shelfRecommendationReviewSchema>;
export type ExpiryWorkItemActionRequest = z.infer<typeof expiryWorkItemActionSchema>;
export type SupplierQuoteRequest = z.infer<typeof supplierQuoteSchema>;
export type CreateDraftPurchaseOrderRequest = z.infer<typeof createDraftPurchaseOrderSchema>;
export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderSchema>;
export type OrderPurchaseOrderRequest = z.infer<typeof orderPurchaseOrderSchema>;
export type ReceivePurchaseOrderRequest = z.infer<typeof receivePurchaseOrderSchema>;
export type ReviewReorderSuggestionRequest = z.infer<typeof reviewReorderSuggestionSchema>;
export type BudgetRegimenRequest = z.infer<typeof budgetRegimenSchema>;
export type CreateReturnRequest = z.infer<typeof createReturnSchema>;
export type RefundReturnRequest = z.infer<typeof refundReturnSchema>;
export type OwnerAiChatRequest = z.infer<typeof ownerAiChatSchema>;
export type OpenCashSessionRequest = z.infer<typeof openCashSessionSchema>;
export type CashMovementRequest = z.infer<typeof cashMovementSchema>;
export type CloseCashSessionRequest = z.infer<typeof closeCashSessionSchema>;
export type ApproveCashVarianceRequest = z.infer<typeof approveCashVarianceSchema>;
