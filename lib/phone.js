// Normalize a US phone number to E.164 (+1XXXXXXXXXX).
// Returns { ok: true, number } or { ok: false, error }.
function normalizeUS(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, error: 'Enter a phone number.' };
  }
  const raw = input.trim();
  let digits = raw.replace(/\D/g, '');

  if (raw.startsWith('+') && !digits.startsWith('1')) {
    return { ok: false, error: 'Only US numbers (+1) are supported.' };
  }
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);

  if (digits.length !== 10) {
    return {
      ok: false,
      error: 'A US number needs 10 digits, for example (207) 337-4818. You entered ' + digits.length + '.'
    };
  }
  if (!/^[2-9]/.test(digits) || !/^[2-9]/.test(digits.slice(3))) {
    return { ok: false, error: 'That is not a valid US number. Area code and exchange cannot start with 0 or 1.' };
  }
  return { ok: true, number: '+1' + digits };
}

// For reading conversations: inbound texts can come from short codes (22395),
// non-US numbers or alphanumeric senders. US numbers are normalized; anything
// else that looks like a plausible sender id is used as stored.
function normalizeContact(input) {
  const us = normalizeUS(input);
  if (us.ok) return us;
  const raw = typeof input === 'string' ? input.trim() : '';
  if (/^\+?[A-Za-z0-9 ._-]{2,20}$/.test(raw)) return { ok: true, number: raw };
  return us;
}

module.exports = { normalizeUS, normalizeContact };
