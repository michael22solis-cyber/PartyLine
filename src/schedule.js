// The two-night timetable (times are local game time; GAME_TZ_OFFSET, default Central Daylight Time).
import { addScheduled } from './store.js';

export const NIGHT1 = [
  ['welcome', '12:00'], ['accomplice', '19:55'], ['intro', '20:00'], ['calls', '20:05'],
  ['cast', '21:15'], ['memo', '21:40'], ['ruthWarning', '22:30'], ['closeNight1', '23:00'],
];
export const NIGHT2 = [
  ['twist', '19:00'], ['planted', '20:00'], ['caretakerHint', '21:00'], ['votesOpen', '22:30'], ['lineRinging', '23:59'],
];

export function scheduleNight(night, day, tz = process.env.GAME_TZ_OFFSET || '-05:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw Object.assign(new Error('Give a date like 2026-10-30'), { status: 400 });
  const plan = night === 1 ? NIGHT1 : night === 2 ? NIGHT2 : null;
  if (!plan) throw Object.assign(new Error('night must be 1 or 2'), { status: 400 });
  const added = plan.map(([beat, time]) => addScheduled(beat, new Date(`${day}T${time}:00${tz}`).toISOString()));
  if (night === 2) {
    const next = new Date(`${day}T12:00:00${tz}`);
    next.setUTCDate(next.getUTCDate() + 1);
    added.push(addScheduled('reveal', new Date(`${next.toISOString().slice(0, 10)}T00:00:00${tz}`).toISOString()));
  }
  return added;
}
