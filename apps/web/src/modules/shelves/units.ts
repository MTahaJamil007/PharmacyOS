/** Shop owners in Pakistan measure in feet; the planner stores whole centimetres. */
export type LengthUnit = 'ft' | 'cm';

export const CM_PER_FOOT = 30.48;
const UNIT_KEY = 'pharmacy-shelf-unit';

export function toUnit(cm: number, unit: LengthUnit): number {
  return unit === 'ft' ? Math.round((cm / CM_PER_FOOT) * 10) / 10 : Math.round(cm);
}

export function fromUnit(value: number, unit: LengthUnit): number {
  return Math.round(unit === 'ft' ? value * CM_PER_FOOT : value);
}

/** 10 ft 6 in, or 320 cm. */
export function formatLength(cm: number, unit: LengthUnit): string {
  if (unit === 'cm') return `${Math.round(cm)} cm`;
  const inches = Math.round(cm / 2.54);
  const feet = Math.floor(inches / 12);
  const rest = inches % 12;
  if (feet === 0) return `${rest} in`;
  return rest === 0 ? `${feet} ft` : `${feet} ft ${rest} in`;
}

export function formatSeconds(seconds: number): string {
  if (seconds >= 600) return 'cannot reach';
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

/** Monthly time saved: "2 h 10 min" or "45 min". */
export function formatMonthlyTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function loadUnit(): LengthUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === 'cm' ? 'cm' : 'ft';
  } catch {
    return 'ft';
  }
}

export function saveUnit(unit: LengthUnit): void {
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch {
    // Without storage the planner simply starts in feet next time.
  }
}
