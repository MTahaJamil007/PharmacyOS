import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PLAN_CODES, PLAN_LABELS, type PlanCode } from '@pharmacy/shared';
import { useState } from 'react';

import {
  getShopFeatureCatalog,
  setShopFeature,
  setShopPlan,
  type FeatureCatalog,
  type FeatureCatalogEntry,
} from '../../api';

/**
 * The software owner's control of what a shop pays for: pick a plan, then switch single
 * features on or off for that shop and set their values. Changes take effect within seconds.
 */
export function ShopFeaturesPanel({
  shopId,
  shopName,
  token,
}: {
  readonly shopId: string;
  readonly shopName: string;
  readonly token: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const key = ['shop-feature-catalog', shopId];
  // Loaded only when opened: the shops page stays quick with many shops.
  const [open, setOpen] = useState(false);
  const catalog = useQuery({
    queryKey: key,
    queryFn: () => getShopFeatureCatalog(token, shopId),
    enabled: open,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<FeatureCatalog>) => {
    setBusy(true);
    setError('');
    try {
      queryClient.setQueryData(key, await action());
      await queryClient.invalidateQueries({ queryKey: ['shop-features'] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Not saved');
    } finally {
      setBusy(false);
    }
  };
  const data = catalog.data && Array.isArray(catalog.data.features) ? catalog.data : undefined;
  const groups = new Map<string, FeatureCatalogEntry[]>();
  for (const feature of data?.features ?? []) {
    groups.set(feature.group, [...(groups.get(feature.group) ?? []), feature]);
  }
  return (
    <details className="shop-features" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        Plan and features
        {data ? <b>{data.planLabel}</b> : null}
        {data ? (
          <small>
            {data.features.filter((feature) => feature.enabled).length} of {data.features.length} on
          </small>
        ) : null}
      </summary>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {data ? (
        <>
          <div className="plan-picker" role="group" aria-label={`Plan for ${shopName}`}>
            {PLAN_CODES.map((plan: PlanCode) => (
              <button
                key={plan}
                type="button"
                aria-pressed={data.plan === plan}
                disabled={busy}
                onClick={() => void run(() => setShopPlan(token, shopId, plan))}
              >
                {PLAN_LABELS[plan]}
                <small>
                  {data.features.filter((feature) => feature.plans.includes(plan)).length} features
                </small>
              </button>
            ))}
          </div>
          {[...groups.entries()].map(([group, features]) => (
            <section key={group} className="feature-group">
              <h4>{group}</h4>
              {features.map((feature) => (
                <FeatureRow
                  key={feature.key}
                  feature={feature}
                  shopName={shopName}
                  inPlan={feature.plans.includes(data.plan)}
                  busy={busy}
                  onSwitch={(enabled) =>
                    void run(() => setShopFeature(token, shopId, feature.key, { enabled }))
                  }
                  onSetting={(name, value) =>
                    void run(() =>
                      setShopFeature(token, shopId, feature.key, {
                        settings: { [name]: value },
                      }),
                    )
                  }
                />
              ))}
            </section>
          ))}
        </>
      ) : (
        <p className="planner-hint">Loading…</p>
      )}
    </details>
  );
}

function FeatureRow({
  feature,
  shopName,
  inPlan,
  busy,
  onSwitch,
  onSetting,
}: {
  readonly feature: FeatureCatalogEntry;
  readonly shopName: string;
  readonly inPlan: boolean;
  readonly busy: boolean;
  readonly onSwitch: (enabled: boolean | null) => void;
  readonly onSetting: (name: string, value: number) => void;
}): React.JSX.Element {
  return (
    <div className={feature.enabled ? 'feature-row on' : 'feature-row'}>
      <span>
        <strong>{feature.label}</strong>
        <small>{feature.description}</small>
        <em>
          {feature.overridden
            ? feature.enabled
              ? 'Added for this shop'
              : 'Removed for this shop'
            : inPlan
              ? 'In the plan'
              : 'Not in the plan'}
          {feature.overridden ? (
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => onSwitch(null)}
            >
              Follow the plan
            </button>
          ) : null}
        </em>
      </span>
      {feature.enabled && feature.settingFields.length > 0 ? (
        <div className="feature-settings">
          {feature.settingFields
            .filter((field) => field.kind === 'number')
            .map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  defaultValue={String(feature.settings[field.key] ?? field.defaultValue)}
                  key={`${field.key}-${String(feature.settings[field.key])}`}
                  aria-label={`${field.label} (${feature.label})`}
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isInteger(value) && value !== feature.settings[field.key]) {
                      onSetting(field.key, value);
                    }
                  }}
                />
                <span>{field.unit}</span>
              </label>
            ))}
        </div>
      ) : null}
      <button
        type="button"
        role="switch"
        aria-checked={feature.enabled}
        aria-label={`${feature.label} for ${shopName}`}
        className={feature.enabled ? 'toggle-switch on' : 'toggle-switch'}
        disabled={busy}
        onClick={() => onSwitch(!feature.enabled)}
      >
        <span />
      </button>
    </div>
  );
}
