// Web push notifications so the burner phone buzzes like a real text.
// Works on Android, desktop, and on iPhone (iOS 16.4+) once the app is added to the home screen.
import webpush from 'web-push';
import { pushSubsFor, removePushSub } from './store.js';

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT = 'mailto:you@example.com' } = process.env;

export const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (pushEnabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
export const vapidPublicKey = VAPID_PUBLIC_KEY || null;

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
