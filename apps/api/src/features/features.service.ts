import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, DatabaseTransaction } from '@pharmacy/database';
import {
  FEATURES,
  isFeatureKey,
  isPlanCode,
  PLAN_LABELS,
  resolveFeatures,
  validateFeatureSettings,
  type FeatureKey,
  type PlanCode,
  type ResolvedFeatures,
} from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { auditShopEvent } from '../common/shop-profile.js';
import { DATABASE } from '../database.module.js';

export interface ShopFeatures {
  readonly plan: PlanCode;
  readonly features: ResolvedFeatures;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly value: ShopFeatures;
}

/** Features change rarely; a short cache keeps the check off every request's critical path. */
const CACHE_MILLISECONDS = 10_000;

@Injectable()
export class FeaturesService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async forShop(branchId: string): Promise<ShopFeatures> {
    const cached = this.cache.get(branchId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.load(this.database, branchId);
    this.cache.set(branchId, { expiresAt: Date.now() + CACHE_MILLISECONDS, value });
    return value;
  }

  async isEnabled(branchId: string, keys: readonly FeatureKey[]): Promise<boolean> {
    const { features } = await this.forShop(branchId);
    return keys.some((key) => features[key].enabled);
  }

  private async load(sql: Database | DatabaseTransaction, branchId: string): Promise<ShopFeatures> {
    const [branch] = await sql<Array<{ plan_code: string }>>`
      select plan_code from branches where id = ${branchId}`;
    if (!branch) throw new NotFoundException('Shop not found');
    const rows = await sql<
      Array<{ feature_key: string; enabled: boolean | null; settings: Record<string, unknown> }>
    >`
      select feature_key, enabled, settings from shop_features where branch_id = ${branchId}`;
    const plan = isPlanCode(branch.plan_code) ? branch.plan_code : 'PRO';
    return {
      plan,
      features: resolveFeatures(
        plan,
        rows.map((row) => ({
          featureKey: row.feature_key,
          enabled: row.enabled,
          settings: row.settings,
        })),
      ),
    };
  }

  /** The catalogue with this shop's state, for the super admin and the shop owner's settings. */
  async describe(branchId: string) {
    this.cache.delete(branchId);
    const shop = await this.forShop(branchId);
    return {
      plan: shop.plan,
      planLabel: PLAN_LABELS[shop.plan],
      features: FEATURES.map((feature) => ({
        key: feature.key,
        group: feature.group,
        label: feature.label,
        description: feature.description,
        plans: feature.plans,
        settingFields: feature.settings,
        ...shop.features[feature.key],
      })),
    };
  }

  async setPlan(actor: AuthenticatedUser, branchId: string, plan: PlanCode) {
    await this.database.begin(async (transaction) => {
      const [shop] = await transaction<Array<{ plan_code: string }>>`
        select plan_code from branches where id = ${branchId} for update`;
      if (!shop) throw new NotFoundException('Shop not found');
      await transaction`
        update branches set plan_code = ${plan}, plan_changed_at = now(),
          plan_changed_by = ${actor.id}
        where id = ${branchId}`;
      await auditShopEvent(transaction, actor, 'PLATFORM.PLAN_CHANGED', branchId, {
        from: shop.plan_code,
        to: plan,
      });
    });
    return this.describe(branchId);
  }

  /** Super admin: switch a feature for one shop (null returns it to the plan) and set its values. */
  async setFeature(
    actor: AuthenticatedUser,
    branchId: string,
    key: string,
    change: { readonly enabled?: boolean | null; readonly settings?: Record<string, unknown> },
  ) {
    if (!isFeatureKey(key)) throw new NotFoundException('Unknown feature');
    const settings = this.validated(key, change.settings ?? {});
    await this.database.begin(async (transaction) => {
      await this.lockShop(transaction, branchId);
      await this.write(transaction, actor, branchId, key, change.enabled, settings);
      await auditShopEvent(transaction, actor, 'PLATFORM.FEATURE_CHANGED', branchId, {
        feature: key,
        enabled: change.enabled === undefined ? 'unchanged' : String(change.enabled),
        settings: Object.keys(settings),
      });
    });
    return this.describe(branchId);
  }

  /** Shop owner: adjust the values of a feature the shop has. Switching features is not theirs. */
  async setSettings(actor: AuthenticatedUser, key: string, input: Record<string, unknown>) {
    if (!isFeatureKey(key)) throw new NotFoundException('Unknown feature');
    const settings = this.validated(key, input);
    await this.database.begin(async (transaction) => {
      await this.lockShop(transaction, actor.branchId);
      const shop = await this.load(transaction, actor.branchId);
      if (!shop.features[key].enabled) {
        throw new BadRequestException('This feature is not switched on for your shop.');
      }
      await this.write(transaction, actor, actor.branchId, key, undefined, settings);
      await auditShopEvent(transaction, actor, 'SHOP.FEATURE_SETTINGS_CHANGED', actor.branchId, {
        feature: key,
        settings: Object.keys(settings),
      });
    });
    return this.describe(actor.branchId);
  }

  private validated(key: FeatureKey, input: Record<string, unknown>) {
    try {
      return validateFeatureSettings(key, input);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid setting');
    }
  }

  private async lockShop(transaction: DatabaseTransaction, branchId: string): Promise<void> {
    const [row] = await transaction<Array<{ id: string }>>`
      select id::text from branches where id = ${branchId} for update`;
    if (!row) throw new NotFoundException('Shop not found');
  }

  private async write(
    transaction: DatabaseTransaction,
    actor: AuthenticatedUser,
    branchId: string,
    key: FeatureKey,
    enabled: boolean | null | undefined,
    settings: Readonly<Record<string, number | boolean>>,
  ): Promise<void> {
    await transaction`
      insert into shop_features (branch_id, feature_key, enabled, settings, updated_by_user_id)
      values (
        ${branchId}, ${key}, ${enabled ?? null}, ${transaction.json({ ...settings })}, ${actor.id}
      )
      on conflict (branch_id, feature_key) do update set
        enabled = case when ${enabled !== undefined} then excluded.enabled
          else shop_features.enabled end,
        settings = shop_features.settings || excluded.settings,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
    `;
    this.cache.delete(branchId);
  }
}
