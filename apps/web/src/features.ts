import { useQuery } from '@tanstack/react-query';
import { ALL_FEATURES_ON, type FeatureKey, type ResolvedFeatures } from '@pharmacy/shared';

import { getShopFeatures } from './api';
import { usePharmacyStore } from './store';

/**
 * The features switched on for this shop. Until the server answers (or when it cannot), every
 * feature shows; the server still refuses anything that is switched off, so nothing leaks.
 */
export function useFeatures(): ResolvedFeatures {
  const token = usePharmacyStore((state) => state.session?.accessToken ?? '');
  const previewMode = import.meta.env.VITE_PREVIEW_MODE === 'true';
  const features = useQuery({
    queryKey: ['shop-features', token],
    queryFn: () => getShopFeatures(token),
    enabled: token !== '' && !previewMode,
    staleTime: 60_000,
    retry: false,
  });
  // Merged key by key, so a server that knows fewer features than this screen never breaks it.
  return features.data?.features
    ? { ...ALL_FEATURES_ON, ...features.data.features }
    : ALL_FEATURES_ON;
}

export function isOn(features: ResolvedFeatures, ...keys: readonly FeatureKey[]): boolean {
  return keys.some((key) => features[key].enabled);
}
