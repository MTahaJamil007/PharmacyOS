import { describe, expect, it } from 'vitest';

import { previewMedicines } from './preview-data';

describe('preview catalog', () => {
  it('keeps preview records deterministic and clearly usable for UI review', () => {
    expect(new Set(previewMedicines.map((medicine) => medicine.id)).size).toBe(
      previewMedicines.length,
    );
    expect(
      previewMedicines.every(
        (medicine) => medicine.shelf !== null && Number(medicine.availableQuantity) > 0,
      ),
    ).toBe(true);
  });
});
