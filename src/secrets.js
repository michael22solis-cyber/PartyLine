// Guarded topics: what a suspect knows but only shares once the game engine approves it for a specific player.
// They come from the episode pack (episodes/<id>/episode.js, where each field is explained); `ask` and `test` arrive
// here as matchers. Locked secrets with an evidence card are the SECRETS list (they count toward the recap score).
import { episode } from './episode.js';

export const TOPICS = episode.secrets;
export const SECRETS = TOPICS.filter((t) => t.card);
export const topicsFor = (npc) => TOPICS.filter((t) => t.who === npc);
export const isPhoneOnly = (id) => Boolean(TOPICS.find((t) => t.id === id)?.phoneOnly);

// Who can be unlocked by being mentioned (by the player, a suspect, or a clue).
export const MENTIONS = episode.mentions;
