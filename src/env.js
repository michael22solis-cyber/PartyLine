// Defaults that depend on where the server runs. Imported right after dotenv, before anything reads process.env.
// On Railway the public domain is provided automatically.
process.env.PUBLIC_HOST ||= process.env.RAILWAY_PUBLIC_DOMAIN || '';
// Where game state lives. On a host, point this at a persistent volume (e.g. /data).
process.env.DATA_DIR ||= 'data';

export { dataFile } from './paths.js';
