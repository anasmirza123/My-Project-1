const { parsePhoneNumberFromString } = require('libphonenumber-js');

const DEFAULT_REGION = 'PK';

/**
 * Returns { ok, normalized, e164Digits } .
 * Valid numbers become E.164 (+923001234567). 0300-1234567, 923001234567 and
 * +92 300 1234567 all normalize to the same value.
 */
function normalizePhone(input, { force = false } = {}) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, reason: 'EMPTY' };
  let parsed;
  try {
    // "92300..." without a plus is a common way people type it
    const candidate = /^92\d{10}$/.test(raw.replace(/[\s\-()]/g, '')) ? '+' + raw.replace(/[\s\-()]/g, '') : raw;
    parsed = parsePhoneNumberFromString(candidate, DEFAULT_REGION);
  } catch (_) { parsed = null; }
  if (parsed && parsed.isValid()) {
    return { ok: true, normalized: parsed.number, digits: parsed.number.slice(1), valid: true };
  }
  const digits = raw.replace(/\D/g, '');
  if (force && digits.length >= 5 && digits.length <= 20) {
    // Saved anyway on purpose: marked so it never collides with a real E.164 value
    return { ok: true, normalized: 'raw:' + digits, digits, valid: false };
  }
  return { ok: false, reason: digits.length < 5 ? 'TOO_SHORT' : 'INVALID' };
}

function waLink(normalized) {
  return normalized && normalized.startsWith('+') ? 'https://wa.me/' + normalized.slice(1) : null;
}

module.exports = { normalizePhone, waLink };
