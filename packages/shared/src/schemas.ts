import { z } from 'zod';

import { decimalToScaledInteger } from './decimal.js';
import { PAYMENT_METHODS } from './domain.js';
import { moneyToMinorUnits, sumMoney } from './money.js';

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
export const taxRateSchema = z
  .string()
  .regex(/^\d{1,3}(?:\.\d{1,2})?$/)
  .refine((value) => decimalToScaledInteger(value, 2) <= 10_000n, 'Tax rate cannot exceed 100%');
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

export const finalizeSaleSchema = z
  .object({
    draftId: idSchema,
    cashSessionId: idSchema,
    clientRequestId: clientRequestIdSchema,
    customerId: idSchema.optional(),
    payments: z
      .array(
        z
          .object({
            method: z.enum(PAYMENT_METHODS),
            amount: positiveMoneySchema,
            tenderedAmount: positiveMoneySchema.optional(),
            reference: z.string().trim().max(120).optional(),
          })
          .superRefine((payment, context) => {
            if (payment.method !== 'CASH' && payment.tenderedAmount !== undefined) {
              context.addIssue({
                code: 'custom',
                message: 'Tendered amount is valid only for cash payments',
                path: ['tenderedAmount'],
              });
            }
            if (
              payment.method === 'CASH' &&
              payment.tenderedAmount !== undefined &&
              moneyToMinorUnits(payment.tenderedAmount) < moneyToMinorUnits(payment.amount)
            ) {
              context.addIssue({
                code: 'custom',
                message: 'Cash tendered cannot be less than the allocated cash amount',
                path: ['tenderedAmount'],
              });
            }
          }),
      )
      .min(1)
      .max(5),
  })
  .superRefine((sale, context) => {
    if (sale.payments.some((payment) => payment.method === 'CREDIT') && !sale.customerId) {
      context.addIssue({
        code: 'custom',
        message: 'A customer is required for credit payment',
        path: ['customerId'],
      });
    }
  });

export const applySaleDiscountSchema = z
  .object({
    lineDiscounts: z
      .array(
        z.object({
          medicineId: idSchema,
          amount: moneySchema,
        }),
      )
      .max(100)
      .default([]),
    invoiceDiscount: moneySchema.default('0'),
    reason: z.string().trim().min(3).max(500),
    clientRequestId: clientRequestIdSchema,
    approverUsername: z.string().trim().min(3).max(100).optional(),
    approverPassword: z.string().min(8).max(256).optional(),
  })
  .superRefine((discount, context) => {
    const ids = discount.lineDiscounts.map((line) => line.medicineId.toString());
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'Each medicine can appear only once',
        path: ['lineDiscounts'],
      });
    }
    if ((discount.approverUsername === undefined) !== (discount.approverPassword === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Approver username and password must be supplied together',
        path: ['approverUsername'],
      });
    }
    const total = sumMoney([
      discount.invoiceDiscount,
      ...discount.lineDiscounts.map((line) => line.amount),
    ]);
    if (moneyToMinorUnits(total) === 0n) {
      context.addIssue({
        code: 'custom',
        message: 'Discount must be greater than zero',
        path: ['invoiceDiscount'],
      });
    }
  });

export const updateBatchPriceSchema = z.object({
  salePrice: moneySchema,
  maximumRetailPrice: moneySchema.nullable().optional(),
  reason: z.string().trim().min(3).max(500),
  clientRequestId: clientRequestIdSchema,
});

export const stockAdjustmentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('COUNT'),
    countedQuantity: quantitySchema,
    reason: z.string().trim().min(3).max(500),
    clientRequestId: clientRequestIdSchema,
  }),
  z.object({
    type: z.literal('SCRAP'),
    quantity: positiveQuantitySchema,
    reason: z.string().trim().min(3).max(500),
    clientRequestId: clientRequestIdSchema,
  }),
]);

export const inventoryBatchSearchSchema = z.object({
  query: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const roleCodeSchema = z.enum([
  'SALESPERSON',
  'CASHIER',
  'SUPERVISOR',
  'INVENTORY_MANAGER',
  'MANAGER',
  'OWNER',
  'SYSTEM_ADMIN',
]);

export const createUserSchema = z.object({
  username: z.string().trim().min(3).max(100),
  displayName: z.string().trim().min(2).max(160),
  password: z.string().min(12).max(256),
  roles: z.array(roleCodeSchema).min(1).max(7),
});

export const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(2).max(160).optional(),
    isActive: z.boolean().optional(),
    roles: z.array(roleCodeSchema).min(1).max(7).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');

export const resetPasswordSchema = z.object({ password: z.string().min(12).max(256) });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(256),
  newPassword: z.string().min(12).max(256),
});

export const createMedicineSchema = z.object({
  sku: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(2).max(200),
  genericName: z.string().trim().max(200).optional(),
  strength: z.string().trim().max(100).optional(),
  dosageForm: z.string().trim().max(100).optional(),
  packSize: positiveQuantitySchema.default('1'),
  unitName: z.string().trim().min(1).max(50).default('unit'),
  barcode: z.string().trim().min(3).max(120).optional(),
  requiresPrescription: z.boolean().default(false),
  storageClass: z.enum(['AMBIENT', 'COLD', 'FROZEN', 'OTHER']).default('AMBIENT'),
  requiresSecuredStorage: z.boolean().default(false),
  hsCode: z
    .string()
    .trim()
    .regex(/^\d{4}\.\d{4}$/)
    .optional(),
  taxRate: taxRateSchema.default('0'),
  fbrUom: z.string().trim().min(1).max(120).default('Numbers, pieces, units'),
  fbrSaleType: z.string().trim().min(1).max(200).default('Goods at standard rate (default)'),
});

export const updateMedicineSchema = z
  .object({
    sku: z.string().trim().min(1).max(100).nullable().optional(),
    name: z.string().trim().min(2).max(200).optional(),
    genericName: z.string().trim().max(200).nullable().optional(),
    strength: z.string().trim().max(100).nullable().optional(),
    dosageForm: z.string().trim().max(100).nullable().optional(),
    packSize: positiveQuantitySchema.optional(),
    unitName: z.string().trim().min(1).max(50).optional(),
    barcode: z.string().trim().min(3).max(120).nullable().optional(),
    requiresPrescription: z.boolean().optional(),
    storageClass: z.enum(['AMBIENT', 'COLD', 'FROZEN', 'OTHER']).optional(),
    requiresSecuredStorage: z.boolean().optional(),
    isActive: z.boolean().optional(),
    hsCode: z
      .string()
      .trim()
      .regex(/^\d{4}\.\d{4}$/)
      .nullable()
      .optional(),
    taxRate: taxRateSchema.optional(),
    fbrUom: z.string().trim().min(1).max(120).optional(),
    fbrSaleType: z.string().trim().min(1).max(200).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');

const supplierFields = {
  code: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).default(1),
};
export const createSupplierSchema = z.object(supplierFields);
export const updateSupplierSchema = z
  .object({
    code: supplierFields.code.nullable(),
    name: supplierFields.name.optional(),
    phone: supplierFields.phone.nullable(),
    address: supplierFields.address.nullable(),
    leadTimeDays: supplierFields.leadTimeDays.optional(),
    isActive: z.boolean().optional(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');

const shelfFields = {
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(2).max(160),
  rack: z.string().trim().max(64).optional(),
  bin: z.string().trim().max(64).optional(),
  rowLabel: z.string().trim().max(64).optional(),
  pickPriority: z.coerce.number().int().min(1).max(10_000).default(100),
  storageClass: z.enum(['AMBIENT', 'COLD', 'FROZEN', 'OTHER']).default('AMBIENT'),
  isSecured: z.boolean().default(false),
  isPickLocation: z.boolean().default(true),
};
export const createShelfSchema = z.object(shelfFields);
export const updateShelfSchema = z
  .object({
    code: shelfFields.code.optional(),
    name: shelfFields.name.optional(),
    rack: shelfFields.rack.nullable(),
    bin: shelfFields.bin.nullable(),
    rowLabel: shelfFields.rowLabel.nullable(),
    pickPriority: shelfFields.pickPriority.optional(),
    storageClass: shelfFields.storageClass.optional(),
    isSecured: shelfFields.isSecured.optional(),
    isPickLocation: shelfFields.isPickLocation.optional(),
    isActive: z.boolean().optional(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');

export const assignShelfSchema = z.object({
  medicineId: idSchema,
  locationType: z.enum(['PRIMARY_PICK', 'SECONDARY_PICK', 'RESERVE']).default('PRIMARY_PICK'),
  isPrimary: z.boolean().default(true),
});

const terminalFields = {
  code: z.string().trim().min(2).max(64),
  name: z.string().trim().min(2).max(160),
  terminalType: z.enum(['SALES_COUNTER', 'CASHIER', 'ADMIN']),
};
export const createTerminalSchema = z.object(terminalFields);
export const updateTerminalSchema = z
  .object({
    code: terminalFields.code.optional(),
    name: terminalFields.name.optional(),
    terminalType: terminalFields.terminalType.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');

export const updateOperationalPoliciesSchema = z
  .object({
    shelfLookbackDays: z.coerce.number().int().min(7).max(365).optional(),
    shelfMinimumPicks: z.coerce.number().int().min(0).max(100_000).optional(),
    shelfMinimumRankImprovement: z.coerce.number().int().min(1).max(10_000).optional(),
    expiryCriticalDays: z.coerce.number().int().min(1).max(365).optional(),
    expiryHighDays: z.coerce.number().int().min(2).max(730).optional(),
    expiryModerateDays: z.coerce.number().int().min(3).max(1_095).optional(),
    targetCoverageDays: z.coerce.number().int().min(1).max(365).optional(),
    regulatedRetentionYears: z.coerce.number().int().min(3).max(25).optional(),
    requireRegimenVerification: z.boolean().optional(),
    cashVarianceApprovalThreshold: moneySchema.optional(),
    basicDiscountLimitPercent: z
      .string()
      .regex(/^\d{1,3}(?:\.\d{1,2})?$/)
      .optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required')
  .superRefine((input, context) => {
    if (
      input.expiryCriticalDays !== undefined &&
      input.expiryHighDays !== undefined &&
      input.expiryHighDays <= input.expiryCriticalDays
    ) {
      context.addIssue({
        code: 'custom',
        message: 'High-risk days must exceed critical days',
        path: ['expiryHighDays'],
      });
    }
    if (
      input.expiryHighDays !== undefined &&
      input.expiryModerateDays !== undefined &&
      input.expiryModerateDays <= input.expiryHighDays
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Moderate-risk days must exceed high-risk days',
        path: ['expiryModerateDays'],
      });
    }
    if (
      input.basicDiscountLimitPercent !== undefined &&
      decimalToScaledInteger(input.basicDiscountLimitPercent, 2) > 10_000n
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Discount limit cannot exceed 100%',
        path: ['basicDiscountLimitPercent'],
      });
    }
  });

export const updateFiscalSettingsSchema = z
  .object({
    sellerNtnCnic: z
      .string()
      .trim()
      .regex(/^\d{7}(?:\d{2}|\d{6})?$/)
      .nullable()
      .optional(),
    sellerStrn: z.string().trim().min(1).max(64).nullable().optional(),
    posRegistrationNumber: z.string().trim().min(1).max(120).nullable().optional(),
    businessName: z.string().trim().min(2).max(200).nullable().optional(),
    province: z.string().trim().min(2).max(120).nullable().optional(),
    scenarioId: z
      .string()
      .trim()
      .regex(/^SN\d{3}$/)
      .nullable()
      .optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');

const customerFields = {
  address: z.string().trim().max(500).optional(),
  creditLimit: moneySchema.default('0'),
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(5).max(32).optional(),
};

export const customerSearchSchema = z.object({
  query: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const createCustomerSchema = z
  .object({
    ...customerFields,
    openingBalance: moneySchema.default('0'),
  })
  .refine(
    (customer) =>
      moneyToMinorUnits(customer.openingBalance) <= moneyToMinorUnits(customer.creditLimit),
    { message: 'Opening balance cannot exceed the credit limit', path: ['openingBalance'] },
  );

export const updateCustomerSchema = z
  .object({
    address: customerFields.address.nullable(),
    creditLimit: moneySchema.optional(),
    isActive: z.boolean().optional(),
    name: customerFields.name.optional(),
    phone: customerFields.phone.nullable(),
  })
  .partial()
  .refine((customer) => Object.keys(customer).length > 0, 'At least one field is required');

export const customerPaymentSchema = z
  .object({
    amount: positiveMoneySchema,
    cashSessionId: idSchema.optional(),
    clientRequestId: clientRequestIdSchema,
    method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']),
    reference: z.string().trim().max(120).optional(),
  })
  .superRefine((payment, context) => {
    if (payment.method === 'CASH' && !payment.cashSessionId) {
      context.addIssue({
        code: 'custom',
        message: 'Cash session is required for cash account payments',
        path: ['cashSessionId'],
      });
    }
    if (payment.method !== 'CASH' && payment.cashSessionId) {
      context.addIssue({
        code: 'custom',
        message: 'Cash session is valid only for cash account payments',
        path: ['cashSessionId'],
      });
    }
  });

export const saleReceiptSearchSchema = z.object({
  query: z.string().trim().max(64).default(''),
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
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER']),
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

export const reportQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    medicineId: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'to must be on or after from',
    path: ['to'],
  });

export const dashboardQuerySchema = z.object({
  date: z.iso.date().optional(),
});

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

export const operationalAlertsQuerySchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).default('OPEN'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type LoginRequest = z.infer<typeof loginSchema>;
export type CreateDraftRequest = z.infer<typeof createDraftSchema>;
export type FinalizeSaleRequest = z.infer<typeof finalizeSaleSchema>;
export type ApplySaleDiscountRequest = z.infer<typeof applySaleDiscountSchema>;
export type UpdateBatchPriceRequest = z.infer<typeof updateBatchPriceSchema>;
export type StockAdjustmentRequest = z.infer<typeof stockAdjustmentSchema>;
export type CreateUserRequest = z.infer<typeof createUserSchema>;
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;
export type CreateMedicineRequest = z.infer<typeof createMedicineSchema>;
export type UpdateMedicineRequest = z.infer<typeof updateMedicineSchema>;
export type CreateSupplierRequest = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierRequest = z.infer<typeof updateSupplierSchema>;
export type CreateShelfRequest = z.infer<typeof createShelfSchema>;
export type UpdateShelfRequest = z.infer<typeof updateShelfSchema>;
export type AssignShelfRequest = z.infer<typeof assignShelfSchema>;
export type CreateTerminalRequest = z.infer<typeof createTerminalSchema>;
export type UpdateTerminalRequest = z.infer<typeof updateTerminalSchema>;
export type UpdateOperationalPoliciesRequest = z.infer<typeof updateOperationalPoliciesSchema>;
export type UpdateFiscalSettingsRequest = z.infer<typeof updateFiscalSettingsSchema>;
export type CreateCustomerRequest = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerRequest = z.infer<typeof updateCustomerSchema>;
export type CustomerPaymentRequest = z.infer<typeof customerPaymentSchema>;
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
