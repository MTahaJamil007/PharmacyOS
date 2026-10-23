/**
 * Features the software owner switches on per shop, grouped into price plans.
 *
 * A shop has a plan; each feature is on when the plan includes it, unless the super admin has
 * switched it on or off for that shop specifically. Settings (durations, thresholds) start from
 * the defaults below and are validated against their ranges wherever they are changed, so a typo
 * can never turn a 90-day expiry window into 9,000 days.
 */

export const PLAN_CODES = ['BASIC', 'STANDARD', 'PRO'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const PLAN_LABELS: Readonly<Record<PlanCode, string>> = {
  BASIC: 'Basic',
  STANDARD: 'Standard',
  PRO: 'Pro',
};

export interface FeatureSetting {
  readonly key: string;
  readonly label: string;
  readonly kind: 'number' | 'boolean';
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly defaultValue: number | boolean;
}

export interface FeatureDefinition {
  readonly key: string;
  readonly group: 'Counter' | 'Cash' | 'Inventory' | 'Shelves' | 'Customers' | 'Owner';
  readonly label: string;
  readonly description: string;
  readonly plans: readonly PlanCode[];
  readonly settings: readonly FeatureSetting[];
}

const ALL: readonly PlanCode[] = ['BASIC', 'STANDARD', 'PRO'];
const STANDARD_UP: readonly PlanCode[] = ['STANDARD', 'PRO'];
const PRO_ONLY: readonly PlanCode[] = ['PRO'];

export const FEATURES = [
  {
    key: 'COUNTER_DOSAGE_TIMING',
    group: 'Counter',
    label: 'Dose timing',
    description: 'Order takers add 1+1+1 style timing that prints on the invoice.',
    plans: ALL,
    settings: [],
  },
  {
    key: 'COUNTER_BUDGET_PLAN',
    group: 'Counter',
    label: 'Budget plan',
    description: 'Fit a prescription into what the customer can pay, at the counter.',
    plans: STANDARD_UP,
    settings: [],
  },
  {
    key: 'COUNTER_SUBSTITUTES',
    group: 'Counter',
    label: 'Same-medicine alternatives',
    description:
      'When a medicine is out of stock, show other companies’ medicine with exactly the same generic, strength and form.',
    plans: STANDARD_UP,
    settings: [],
  },
  {
    key: 'COUNTER_SELL_FIRST',
    group: 'Counter',
    label: 'Sell near-expiry first',
    description: 'Mark medicines whose stock expires soon so the counter offers them first.',
    plans: PRO_ONLY,
    settings: [
      {
        key: 'withinDays',
        label: 'Expires within',
        kind: 'number',
        unit: 'days',
        min: 15,
        max: 365,
        defaultValue: 90,
      },
    ],
  },
  {
    key: 'CUSTOMER_REQUESTS',
    group: 'Customers',
    label: 'Customer requests',
    description:
      'The order taker marks medicines customers ask for that the shop does not have; repeated requests are counted for buying.',
    plans: STANDARD_UP,
    settings: [
      {
        key: 'reportDays',
        label: 'Count requests from the last',
        kind: 'number',
        unit: 'days',
        min: 7,
        max: 365,
        defaultValue: 30,
      },
      {
        key: 'minimumRequests',
        label: 'Show when asked at least',
        kind: 'number',
        unit: 'times',
        min: 1,
        max: 50,
        defaultValue: 2,
      },
    ],
  },
  {
    key: 'CUSTOMER_CREDIT',
    group: 'Customers',
    label: 'Customer credit (khata)',
    description: 'Sell on account and take payments against it.',
    plans: STANDARD_UP,
    settings: [],
  },
  {
    key: 'MULTI_COUNTER',
    group: 'Cash',
    label: 'Several cash counters',
    description:
      'Order takers choose which cash counter takes the payment; each counter sees its own bills first.',
    plans: STANDARD_UP,
    settings: [],
  },
  {
    key: 'SCAN_RECEIVING',
    group: 'Inventory',
    label: 'Fast scan receiving',
    description: 'Receive new stock by scanning pack barcodes; batch and expiry fill themselves.',
    plans: ALL,
    settings: [
      {
        key: 'warnShelfLifeDays',
        label: 'Warn when stock arrives with less than',
        kind: 'number',
        unit: 'days of shelf life',
        min: 0,
        max: 1095,
        defaultValue: 180,
      },
    ],
  },
  {
    key: 'LOW_STOCK',
    group: 'Inventory',
    label: 'Low stock alerts',
    description: 'Warn before a medicine runs out, from how fast it sells.',
    plans: ALL,
    settings: [
      {
        key: 'lookbackDays',
        label: 'Judge sales over the last',
        kind: 'number',
        unit: 'days',
        min: 7,
        max: 180,
        defaultValue: 30,
      },
      {
        key: 'coverDays',
        label: 'Keep enough stock for',
        kind: 'number',
        unit: 'days',
        min: 1,
        max: 90,
        defaultValue: 7,
      },
    ],
  },
  {
    key: 'STUCK_STOCK',
    group: 'Inventory',
    label: 'Stuck stock',
    description: 'List stock that has not sold for a long time, with the money tied up in it.',
    plans: STANDARD_UP,
    settings: [
      {
        key: 'days',
        label: 'Not sold for',
        kind: 'number',
        unit: 'days',
        min: 15,
        max: 730,
        defaultValue: 90,
      },
    ],
  },
  {
    key: 'EXPIRY_ALERTS',
    group: 'Inventory',
    label: 'Expiry alerts',
    description: 'List stock that expires soon, most urgent first.',
    plans: ALL,
    settings: [
      {
        key: 'days',
        label: 'Expires within',
        kind: 'number',
        unit: 'days',
        min: 7,
        max: 730,
        defaultValue: 90,
      },
    ],
  },
  {
    key: 'PURCHASE_ORDERS',
    group: 'Inventory',
    label: 'Purchase orders and order list',
    description: 'Build orders for suppliers from low stock and customer requests.',
    plans: STANDARD_UP,
    settings: [],
  },
  {
    key: 'SHELF_LOCATIONS',
    group: 'Shelves',
    label: 'Shelf names and A to Z places',
    description: 'Name racks and levels; new medicines get their place from their name.',
    plans: STANDARD_UP,
    settings: [],
  },
  {
    key: 'SHELF_PLANNER_3D',
    group: 'Shelves',
    label: '3D shop planner',
    description: 'Draw the shop in 3D and accept re-arrangement suggestions.',
    plans: PRO_ONLY,
    settings: [],
  },
  {
    key: 'OWNER_DASHBOARD',
    group: 'Owner',
    label: 'Owner dashboard',
    description: 'Daily sales, profit, expiry and stock figures for the owner.',
    plans: STANDARD_UP,
    settings: [],
  },
  {
    key: 'OWNER_AI',
    group: 'Owner',
    label: 'Owner assistant',
    description: 'Ask questions about the business in plain language.',
    plans: PRO_ONLY,
    settings: [],
  },
] as const satisfies readonly FeatureDefinition[];

export type FeatureKey = (typeof FEATURES)[number]['key'];
export const FEATURE_KEYS = FEATURES.map((feature) => feature.key) as readonly FeatureKey[];

export type FeatureSettings = Readonly<Record<string, number | boolean>>;

export interface ResolvedFeature {
  readonly enabled: boolean;
  /** True when the super admin set this shop apart from its plan. */
  readonly overridden: boolean;
  readonly settings: FeatureSettings;
}

export type ResolvedFeatures = Readonly<Record<FeatureKey, ResolvedFeature>>;

export interface FeatureOverride {
  readonly featureKey: string;
  readonly enabled: boolean | null;
  readonly settings: Readonly<Record<string, unknown>>;
}

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function featureDefinition(key: FeatureKey): FeatureDefinition {
  return FEATURES.find((feature) => feature.key === key)!;
}

export function isPlanCode(value: string): value is PlanCode {
  return (PLAN_CODES as readonly string[]).includes(value);
}

/**
 * Checks a settings change against the feature's ranges. Unknown keys and out-of-range values are
 * refused with a message naming the setting.
 */
export function validateFeatureSettings(
  key: FeatureKey,
  input: Readonly<Record<string, unknown>>,
): FeatureSettings {
  const definition = featureDefinition(key);
  const result: Record<string, number | boolean> = {};
  for (const [name, value] of Object.entries(input)) {
    const setting = definition.settings.find((item) => item.key === name);
    if (!setting) throw new Error(`${definition.label} has no setting called ${name}`);
    if (setting.kind === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`${setting.label} must be on or off`);
      result[name] = value;
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error(`${setting.label} must be a whole number`);
    }
    if (
      (setting.min !== undefined && value < setting.min) ||
      (setting.max !== undefined && value > setting.max)
    ) {
      throw new Error(
        `${setting.label} must be between ${setting.min ?? 0} and ${setting.max ?? value}${setting.unit ? ` ${setting.unit}` : ''}`,
      );
    }
    result[name] = value;
  }
  return result;
}

/** The shop's effective features: plan defaults, then the super admin's per-shop overrides. */
export function resolveFeatures(
  plan: PlanCode,
  overrides: readonly FeatureOverride[],
): ResolvedFeatures {
  const byKey = new Map(overrides.map((override) => [override.featureKey, override]));
  const resolved = {} as Record<FeatureKey, ResolvedFeature>;
  for (const feature of FEATURES as readonly FeatureDefinition[]) {
    const override = byKey.get(feature.key);
    const settings: Record<string, number | boolean> = {};
    for (const setting of feature.settings) {
      const stored = override?.settings[setting.key];
      const valid =
        setting.kind === 'boolean'
          ? typeof stored === 'boolean'
          : typeof stored === 'number' &&
            Number.isInteger(stored) &&
            (setting.min === undefined || stored >= setting.min) &&
            (setting.max === undefined || stored <= setting.max);
      settings[setting.key] = valid ? (stored as number | boolean) : setting.defaultValue;
    }
    const planDefault = feature.plans.includes(plan);
    const enabled = override?.enabled ?? planDefault;
    resolved[feature.key as FeatureKey] = {
      enabled,
      overridden:
        override?.enabled !== null &&
        override?.enabled !== undefined &&
        override.enabled !== planDefault,
      settings,
    };
  }
  return resolved;
}

/** Every feature on with default settings: what a client assumes before the server answers. */
export const ALL_FEATURES_ON: ResolvedFeatures = resolveFeatures('PRO', []);

export function numberSetting(
  features: ResolvedFeatures,
  key: FeatureKey,
  setting: string,
): number {
  const value = features[key].settings[setting];
  return typeof value === 'number' ? value : 0;
}
