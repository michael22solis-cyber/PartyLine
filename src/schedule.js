// Schedule a whole game ahead of time: the chosen length's timetable (modes.js), starting at a given moment.
// `setup` runs at the start, so everyone should have joined by then.
import { addScheduled } from './store.js';
import { LENGTHS } from './modes.js';

export function scheduleGame(at, length = 'quick') {
  const start = new Date(at || '');
  if (Number.isNaN(start.getTime())) throw Object.assign(new Error('Give a start time, like 2026-10-31T20:00'), { status: 400 });
  const plan = LENGTHS[length];
  if (!plan) throw Object.assign(new Error(`Length must be one of: ${Object.keys(LENGTHS).join(', ')}`), { status: 400 });
  return plan.beats.map(([beat, min]) => addScheduled(beat, new Date(start.getTime() + min * 60_000).toISOString()));
}
