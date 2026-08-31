import { describe, expect, it } from 'vitest';
import { decimalToScaledInteger } from '@pharmacy/shared';

import { previewMedicines } from './preview-data';

describe('preview catalog', () => {
  it('keeps preview records deterministic and clearly usable for UI review', () => {
    expect(new Set(previewMedicines.map((medicine) => medicine.id)).size).toBe(
      previewMedicines.length,
    );
    expect(
      previewMedicines.every(
        (medicine) =>
          medicine.shelf !== null && decimalToScaledInteger(medicine.availableQuantity, 3) > 0n,
      ),
    ).toBe(true);
  });
});
