// Web push notifications so the burner phone buzzes like a real text.
// Works on Android, desktop, and on iPhone (iOS 16.4+) once the app is added to the home screen.
import webpush from 'web-push';
import { pushSubsFor, removePushSub } from './store.js';

// Forgive copy-paste slips (spaces, line breaks, quotes, a missing "mailto:"): a bad key turns alerts off, never the server.
const clean = (v) => String(v || '').replace(/\s+/g, '').replace(/^["']|["']$/g, '');
const pub = clean(process.env.VAPID_PUBLIC_KEY);
const priv = clean(process.env.VAPID_PRIVATE_KEY);
let subject = String(process.env.VAPID_SUBJECT || '').trim() || 'mailto:you@example.com';
if (!/^(mailto:|https?:\/\/)/i.test(subject)) subject = `mailto:${subject}`;

let ok = false;
if (pub && priv) {
  try {
    webpush.setVapidDetails(subject, pub, priv);
    ok = true;
    console.log('[push] alerts are ON.');
  } catch (err) {
    console.error(`[push] alerts are OFF: the VAPID keys in your settings don't work (${err.message}). Make a new pair with "npx web-push generate-vapid-keys" and paste them again.`);
  }
} else console.log('[push] alerts are OFF: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set.');
export const pushEnabled = ok;
export const vapidPublicKey = ok ? pub : null;

export async function notify(token, { title, body, thread }) {
  if (!pushEnabled) return;
  const payload = JSON.stringify({ title, body, url: `/p/${token}#${thread || ''}` });
  await Promise.all(
    pushSubsFor(token).map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload, { TTL: 3600 });
      } catch (err) {
        // 404/410 = subscription expired; drop it.
        if (err.statusCode === 404 || err.statusCode === 410) removePushSub(token, sub.endpoint);
        else console.error('push failed:', err.statusCode || err.message);
      }
    }),
  );
}
