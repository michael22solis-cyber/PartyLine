// Where game data lives. Tests and simulations point this somewhere temporary with BLACKWOOD_DATA_DIR.
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.BLACKWOOD_DATA_DIR || 'data');
export const dataFile = (name) => path.join(DATA_DIR, name);
