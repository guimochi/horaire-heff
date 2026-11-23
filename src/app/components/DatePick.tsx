import { addDays, mondayOf } from '../../shared/time';
import { Icon } from './Icon';

/** Calendar button over an invisible native date input: the iPhone opens its own picker. Only published weeks are pickable. */
export function DatePick({ weeks, value, onPick }: { weeks: string[]; value: string; onPick: (date: string) => void }) {
  const sorted = [...weeks].sort();
  return (
    <span class="icon-btn date-pick">
      <Icon name="day" size={21} width={1.8} />
      <input type="date" aria-label="Aller à une date" value={value} min={sorted[0]} max={addDays(sorted[sorted.length - 1], 6)}
        onInput={(e) => { const v = e.currentTarget.value; if (v && weeks.includes(mondayOf(v))) onPick(v); }} />
    </span>
  );
}
