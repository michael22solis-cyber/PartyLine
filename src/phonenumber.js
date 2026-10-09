// Phone numbers as people type them: "8066328929", "(806) 632-8929", "806.632.8929", "1 806 632 8929" or
// "+18066328929" all become +18066328929. Ten digits are taken as a US number; anything else needs its country code.
// Returns null when it can't be a phone number.
export function normalizePhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return /^\d{10,15}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
