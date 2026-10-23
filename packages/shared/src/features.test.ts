import { describe, expect, it } from 'vitest';

import {
  ALL_FEATURES_ON,
  FEATURES,
  numberSetting,
  resolveFeatures,
  validateFeatureSettings,
} from './features.js';

describe('feature plans', () => {
  it('gives each plan its features and Pro everything', () => {
    const basic = resolveFeatures('BASIC', []);
    expect(basic.SCAN_RECEIVING.enabled).toBe(true);
    expect(basic.SHELF_PLANNER_3D.enabled).toBe(false);
    expect(basic.CUSTOMER_REQUESTS.enabled).toBe(false);
    const standard = resolveFeatures('STANDARD', []);
    expect(standard.CUSTOMER_REQUESTS.enabled).toBe(true);
    expect(standard.OWNER_AI.enabled).toBe(false);
    expect(Object.values(ALL_FEATURES_ON).every((feature) => feature.enabled)).toBe(true);
    expect(Object.keys(ALL_FEATURES_ON)).toHaveLength(FEATURES.length);
  });

  it('lets the super admin switch single features against the plan', () => {
    const features = resolveFeatures('BASIC', [
      { featureKey: 'SHELF_PLANNER_3D', enabled: true, settings: {} },
      { featureKey: 'LOW_STOCK', enabled: false, settings: {} },
      { featureKey: 'EXPIRY_ALERTS', enabled: null, settings: { days: 45 } },
    ]);
    expect(features.SHELF_PLANNER_3D).toMatchObject({ enabled: true, overridden: true });
    expect(features.LOW_STOCK).toMatchObject({ enabled: false, overridden: true });
    expect(features.EXPIRY_ALERTS).toMatchObject({ enabled: true, overridden: false });
    expect(numberSetting(features, 'EXPIRY_ALERTS', 'days')).toBe(45);
  });

  it('falls back to defaults for missing or corrupt stored settings', () => {
    const features = resolveFeatures('PRO', [
      { featureKey: 'STUCK_STOCK', enabled: null, settings: { days: 99999 } },
      { featureKey: 'CUSTOMER_REQUESTS', enabled: null, settings: { reportDays: '14' } },
    ]);
    expect(numberSetting(features, 'STUCK_STOCK', 'days')).toBe(90);
    expect(numberSetting(features, 'CUSTOMER_REQUESTS', 'reportDays')).toBe(30);
  });

  it('validates settings against their ranges with a readable message', () => {
    expect(validateFeatureSettings('STUCK_STOCK', { days: 120 })).toEqual({ days: 120 });
    expect(() => validateFeatureSettings('STUCK_STOCK', { days: 5 })).toThrow(
      /Not sold for must be between 15 and 730 days/,
    );
    expect(() => validateFeatureSettings('STUCK_STOCK', { days: 30.5 })).toThrow(/whole number/);
    expect(() => validateFeatureSettings('STUCK_STOCK', { weeks: 3 })).toThrow(/no setting/);
  });
});
