/**
 * Decides whether two catalogue entries are the same medicine from different companies.
 *
 * This is a patient-safety rule, so it is deliberately strict: the generic name (including release
 * modifiers such as XR or SR), the strength, and the dosage form must all match after only cosmetic
 * clean-up (case, spacing, plural forms). It never converts units (0.5 g is not matched to 500 mg),
 * never reorders combination ingredients, and returns no key at all when any part is missing, so an
 * incomplete catalogue entry is never offered as a substitute.
 */

export interface Formulation {
  readonly genericName: string | null | undefined;
  readonly strength: string | null | undefined;
  readonly dosageForm: string | null | undefined;
}

const FORM_SYNONYMS: Readonly<Record<string, string>> = {
  tab: 'tablet',
  tabs: 'tablet',
  tablet: 'tablet',
  tablets: 'tablet',
  cap: 'capsule',
  caps: 'capsule',
  capsule: 'capsule',
  capsules: 'capsule',
  inj: 'injection',
  injection: 'injection',
  injections: 'injection',
  syp: 'syrup',
  syrup: 'syrup',
  syrups: 'syrup',
  susp: 'suspension',
  suspension: 'suspension',
  suspensions: 'suspension',
  sachet: 'sachet',
  sachets: 'sachet',
  cream: 'cream',
  creams: 'cream',
  ointment: 'ointment',
  ointments: 'ointment',
  gel: 'gel',
  gels: 'gel',
  lotion: 'lotion',
  lotions: 'lotion',
  infusion: 'infusion',
  infusions: 'infusion',
  suppository: 'suppository',
  suppositories: 'suppository',
  inhaler: 'inhaler',
  inhalers: 'inhaler',
};

function clean(value: string | null | undefined): string | null {
  const text = value?.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return text ? text : null;
}

export function normalizeGenericName(value: string | null | undefined): string | null {
  const text = clean(value);
  return text ? text.replace(/\s*\+\s*/g, ' + ').replace(/[.,;]+$/g, '') : null;
}

export function normalizeStrength(value: string | null | undefined): string | null {
  const text = clean(value);
  return text ? text.replace(/\s+/g, '').replace(/µg|μg/g, 'mcg') : null;
}

export function normalizeDosageForm(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  return FORM_SYNONYMS[text] ?? text;
}

/** One string per exact formulation, or null when the entry is incomplete. */
export function formulationKey(formulation: Formulation): string | null {
  const generic = normalizeGenericName(formulation.genericName);
  const strength = normalizeStrength(formulation.strength);
  const form = normalizeDosageForm(formulation.dosageForm);
  if (!generic || !strength || !form) return null;
  return `${generic}|${strength}|${form}`;
}

export function isSameFormulation(left: Formulation, right: Formulation): boolean {
  const key = formulationKey(left);
  return key !== null && key === formulationKey(right);
}

/** "Metformin XR 500mg tablet", as staff read it back to the customer. */
export function describeFormulation(formulation: Formulation): string {
  return [
    formulation.genericName?.trim(),
    formulation.strength?.trim(),
    normalizeDosageForm(formulation.dosageForm),
  ]
    .filter(Boolean)
    .join(' ');
}
