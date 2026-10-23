import { describe, expect, it } from 'vitest';

import { describeFormulation, formulationKey, isSameFormulation } from './formulation.js';

describe('same-medicine matching', () => {
  it('matches the same generic, strength and form across companies', () => {
    expect(
      isSameFormulation(
        { genericName: 'Paracetamol', strength: '250mg/5ml', dosageForm: 'Suspension' },
        { genericName: ' paracetamol ', strength: '250 mg / 5 ml', dosageForm: 'suspension' },
      ),
    ).toBe(true);
    expect(
      isSameFormulation(
        { genericName: 'Amoxicillin + Clavulanic Acid', strength: '625mg', dosageForm: 'Tablets' },
        { genericName: 'amoxicillin+clavulanic acid', strength: '625MG', dosageForm: 'tab' },
      ),
    ).toBe(true);
  });

  it('never matches a different release form, strength, or dosage form', () => {
    const plain = { genericName: 'Metformin', strength: '500mg', dosageForm: 'tablets' };
    expect(
      isSameFormulation(plain, {
        genericName: 'Metformin XR',
        strength: '500mg',
        dosageForm: 'tablets',
      }),
    ).toBe(false);
    expect(isSameFormulation(plain, { ...plain, strength: '850mg' })).toBe(false);
    expect(isSameFormulation(plain, { ...plain, strength: '0.5g' })).toBe(false);
    expect(
      isSameFormulation(
        { genericName: 'Paracetamol', strength: '120mg/5ml', dosageForm: 'syrup' },
        { genericName: 'Paracetamol', strength: '120mg/5ml', dosageForm: 'suspension' },
      ),
    ).toBe(false);
    expect(
      isSameFormulation(
        { genericName: 'Ciprofloxacin', strength: '0.3%', dosageForm: 'eye drops' },
        { genericName: 'Ciprofloxacin', strength: '0.3%', dosageForm: 'ear drops' },
      ),
    ).toBe(false);
  });

  it('does not reorder combination ingredients', () => {
    expect(
      isSameFormulation(
        {
          genericName: 'Amoxicillin + Clavulanic Acid',
          strength: '500mg/125mg',
          dosageForm: 'tablet',
        },
        {
          genericName: 'Clavulanic Acid + Amoxicillin',
          strength: '500mg/125mg',
          dosageForm: 'tablet',
        },
      ),
    ).toBe(false);
  });

  it('offers nothing for an incomplete catalogue entry', () => {
    expect(
      formulationKey({ genericName: 'Cetirizine', strength: null, dosageForm: 'tablets' }),
    ).toBeNull();
    expect(
      isSameFormulation(
        { genericName: 'Cetirizine', strength: '', dosageForm: 'tablets' },
        { genericName: 'Cetirizine', strength: '', dosageForm: 'tablets' },
      ),
    ).toBe(false);
  });

  it('describes the formulation in words staff read back', () => {
    expect(
      describeFormulation({
        genericName: 'Metformin XR',
        strength: '500mg',
        dosageForm: 'Tablets',
      }),
    ).toBe('Metformin XR 500mg tablet');
  });
});
