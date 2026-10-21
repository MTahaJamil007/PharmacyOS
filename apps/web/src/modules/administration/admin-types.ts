/** Shapes returned by the /admin endpoints (see AdministrationService and UsersService). */

export type RoleCode =
  | 'SALESPERSON'
  | 'CASHIER'
  | 'SUPERVISOR'
  | 'INVENTORY_MANAGER'
  | 'MANAGER'
  | 'OWNER'
  | 'SYSTEM_ADMIN';

export interface AdminUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly isActive: boolean;
  readonly lockedUntil: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly roles: readonly RoleCode[];
}

export interface AdminRole {
  readonly code: RoleCode;
  readonly name: string;
  readonly description: string | null;
}

export type StorageClass = 'AMBIENT' | 'COLD' | 'FROZEN' | 'OTHER';

export interface AdminMedicine {
  readonly id: string;
  readonly sku: string | null;
  readonly name: string;
  readonly genericName: string | null;
  readonly strength: string | null;
  readonly dosageForm: string | null;
  readonly packSize: string;
  readonly unitName: string;
  readonly requiresPrescription: boolean;
  readonly storageClass: StorageClass;
  readonly requiresSecuredStorage: boolean;
  readonly hsCode: string | null;
  readonly taxRate: string;
  readonly fbrUom: string;
  readonly fbrSaleType: string;
  readonly isActive: boolean;
  readonly barcode: string | null;
}

export interface AdminSupplier {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly phone: string | null;
  readonly address: string | null;
  readonly leadTimeDays: number;
  readonly isActive: boolean;
}

export interface AdminShelf {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly rack: string | null;
  readonly bin: string | null;
  readonly rowLabel: string | null;
  readonly pickPriority: number;
  readonly storageClass: StorageClass;
  readonly isSecured: boolean;
  readonly isPickLocation: boolean;
  readonly isActive: boolean;
}

export type TerminalType = 'SALES_COUNTER' | 'CASHIER' | 'ADMIN';

export interface AdminTerminal {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly terminalType: TerminalType;
  readonly isActive: boolean;
  readonly lastSeenAt: string | null;
}

export interface OperationalPolicies {
  readonly shelfLookbackDays: number;
  readonly shelfMinimumPicks: number;
  readonly shelfMinimumRankImprovement: number;
  readonly expiryCriticalDays: number;
  readonly expiryHighDays: number;
  readonly expiryModerateDays: number;
  readonly targetCoverageDays: number;
  readonly regulatedRetentionYears: number;
  readonly requireRegimenVerification: boolean;
  readonly cashVarianceApprovalThreshold: string;
  readonly basicDiscountLimitPercent: string;
  readonly updatedAt: string;
}

export interface FiscalSettings {
  readonly sellerNtnCnic: string | null;
  readonly sellerStrn: string | null;
  readonly posRegistrationNumber: string | null;
  readonly businessName: string | null;
  readonly province: string | null;
  readonly scenarioId: string | null;
}

/** Turns an empty text box into `null` so PATCH clears the value instead of storing ''. */
export function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Omits empty optional fields on create, where the server applies its own defaults. */
export function withoutBlanks<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => !(typeof value === 'string' && value.trim() === ''),
    ),
  ) as Partial<T>;
}
