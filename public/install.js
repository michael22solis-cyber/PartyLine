// The game is played from the home screen. On a phone, a private link opened in a browser tab asks to be added as an
// app first: iPhones only deliver alerts (and so incoming calls) to home-screen apps, and every player ends up in the
// same full-screen phone. Computers play in the browser. REQUIRE_INSTALL=off on the server turns the gate off.

// Browsers built into other apps can't add anything to the home screen; the player has to open the link elsewhere.
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Snapchat|TikTok|musical_ly|Bytedance|LinkedInApp|\bLine\/|Twitter|; wv\)/i;

// iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
export function deviceOS({ ua = '', platform = '', touchPoints = 0 } = {}) {
  if (/iphone|ipad|ipod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return null;
}

// null: play here. Otherwise which instructions to show.
export function installGate({ ua = '', platform = '', touchPoints = 0, standalone = false, required = true } = {}) {
  if (!required || standalone) return null;
  const os = deviceOS({ ua, platform, touchPoints });
  if (!os) return null;
  return { os, inApp: IN_APP.test(ua) };
}
