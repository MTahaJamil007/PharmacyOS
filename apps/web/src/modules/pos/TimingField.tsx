import { DOSAGE_PRESETS, describeDosage, formatDosage, parseDosage } from '@pharmacy/shared';

/**
 * Timing is typed, not picked: "101" is three keystrokes where a dropdown is a click, a scroll
 * and a click. The preset chips under it serve the mouse and teach the shorthand.
 */
export function timingPreview(text: string): { readonly label: string; readonly valid: boolean } {
  if (text.trim() === '') return { label: '', valid: true };
  const parsed = parseDosage(text);
  return 'schedule' in parsed
    ? { label: describeDosage(parsed.schedule), valid: true }
    : { label: parsed.error, valid: false };
}

export function TimingPresets({
  value,
  onPick,
}: {
  readonly value: string;
  readonly onPick: (text: string) => void;
}): React.JSX.Element {
  const parsed = value.trim() ? parseDosage(value) : null;
  const schedule = parsed && 'schedule' in parsed ? parsed.schedule : null;
  const current = schedule ? formatDosage({ ...schedule, meal: null }) : '';
  const pickMeal = (meal: 'BEFORE' | 'AFTER'): void => {
    if (!schedule) return;
    onPick(formatDosage({ ...schedule, meal: schedule.meal === meal ? null : meal }));
  };
  return (
    // Buttons keep focus in the field they serve, so picking never interrupts typing.
    <div className="timing-presets" role="group" aria-label="Timing presets">
      {DOSAGE_PRESETS.map((preset) => (
        <button
          type="button"
          key={preset}
          tabIndex={-1}
          aria-pressed={current === preset}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() =>
            onPick(schedule?.meal ? `${preset} ${schedule.meal === 'AFTER' ? 'a' : 'b'}` : preset)
          }
        >
          {preset}
        </button>
      ))}
      <span className="preset-divider" aria-hidden="true" />
      {(['BEFORE', 'AFTER'] as const).map((meal) => (
        <button
          type="button"
          key={meal}
          tabIndex={-1}
          disabled={!schedule}
          aria-pressed={schedule?.meal === meal}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pickMeal(meal)}
        >
          {meal === 'BEFORE' ? 'Before meal' : 'After meal'}
        </button>
      ))}
      <span className="preset-hint">
        Type <kbd>101</kbd> = 1+0+1 · <kbd>h</kbd> = ½ · end with <kbd>a</kbd>/<kbd>b</kbd> for
        after/before meal
      </span>
    </div>
  );
}
