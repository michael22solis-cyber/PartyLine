// Where game data lives: DATA_DIR (a persistent volume on a host), or BLACKWOOD_DATA_DIR for tests and simulations.
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.BLACKWOOD_DATA_DIR || process.env.DATA_DIR || 'data');
export const dataFile = (name) => path.join(DATA_DIR, name);
