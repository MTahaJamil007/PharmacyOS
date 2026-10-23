import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '@pharmacy/shared';

export const FEATURE_METADATA_KEY = 'required-feature';

/** The route works only while at least one of these features is on for the caller's shop. */
export const RequireFeature = (...features: FeatureKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(FEATURE_METADATA_KEY, features);
