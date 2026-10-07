// Place real phone calls from a character to a player.
import twilio from 'twilio';
import { streamTwiml } from './twiml.js';

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, CARETAKER_NUMBER, PUBLIC_HOST, MAX_CALL_SECONDS = 240 } = process.env;

let client = null;
const getClient = () => {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) throw new Error('Twilio credentials missing in .env');
  client ||= twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return client;
};

export async function callPhone(to, playerName, character = 'caretaker', pid = null) {
  if (!/^\+\d{10,15}$/.test(to || '')) throw new Error(`Bad phone number: ${to}`);
  const call = await getClient().calls.create({
    to,
    from: CARETAKER_NUMBER,
    twiml: streamTwiml(PUBLIC_HOST, character, playerName, 'outbound', pid),
    timeLimit: Number(MAX_CALL_SECONDS), // hard cap
  });
  return call.sid;
}
