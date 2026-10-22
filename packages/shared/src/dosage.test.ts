import { describe, expect, it } from 'vitest';

import {
  describeDosage,
  describeDosageUrdu,
  dosageQuantityForDays,
  dosageUnitsPerDay,
  formatDosage,
  normalizeDosage,
  parseDosage,
} from './dosage.js';

function schedule(input: string) {
  const parsed = parseDosage(input);
  if (!('schedule' in parsed)) throw new Error(parsed.error);
  return parsed.schedule;
}

describe('dosage shorthand', () => {
  it.each([
    ['101', '1+0+1'],
    ['111', '1+1+1'],
    ['h0h', '½+0+½'],
    ['q00', '¼+0+0'],
    ['101a', '1+0+1 after meal'],
    ['111 b', '1+1+1 before meal'],
    ['1+0+1', '1+0+1'],
    ['1-0-1', '1+0+1'],
    ['1 0 1', '1+0+1'],
    ['1/2+0+1/2', '½+0+½'],
    ['½+0+½ after meal', '½+0+½ after meal'],
    ['1.5+0+1.5', '1½+0+1½'],
    ['2+2+2 (before)', '2+2+2 before meal'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeDosage(input)).toBe(expected);
  });

  it.each(['', '10', '1+1', '1+0+1+1', '000', '0.3+0+0', '1/3+0+0', '10+0+0', 'abc'])(
    'rejects %s',
    (input) => {
      expect('error' in parseDosage(input)).toBe(true);
    },
  );

  it('round-trips its own canonical text', () => {
    for (const code of ['101', 'h0h', '1.5+0+1.5 a', 't0t b']) {
      const text = formatDosage(schedule(code));
      expect(normalizeDosage(text)).toBe(text);
    }
  });
});

describe('dosage arithmetic', () => {
  it('totals the day exactly and rounds days up to whole units', () => {
    expect(dosageUnitsPerDay(schedule('101'))).toBe('2.000');
    expect(dosageUnitsPerDay(schedule('h0h'))).toBe('1.000');
    expect(dosageUnitsPerDay(schedule('q00'))).toBe('0.250');
    expect(dosageQuantityForDays(schedule('111'), 5)).toBe(15);
    expect(dosageQuantityForDays(schedule('h00'), 5)).toBe(3);
    expect(() => dosageQuantityForDays(schedule('101'), 0)).toThrow();
  });

  it('describes the schedule for the patient in English and Urdu', () => {
    expect(describeDosage(schedule('101a'))).toBe('Morning 1 · Night 1 · after meal');
    expect(describeDosageUrdu(schedule('h00b'))).toBe('صبح ½ · کھانے سے پہلے');
  });
});
