import { createHash, randomBytes } from 'node:crypto';

// Printed cards avoid 0/O and 1/I/L. Legacy QTA + 36 hex codes stay redeemable.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP = 4;
const GROUPS = 4;

export function canonicalCompact(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/gu, '');
}

export function formatActivationCode(compact) {
  if (/^QTA[0-9A-F]{36}$/u.test(compact)) return `QTA-${compact.slice(3)}`;
  if (new RegExp(`^QTA[${CODE_ALPHABET}]{${GROUP * GROUPS}}$`, 'u').test(compact)) {
    const body = compact.slice(3);
    return `QTA-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12)}`;
  }
  return null;
}

export function activationCodeDigest(value) {
  const compact = canonicalCompact(value);
  const formatted = formatActivationCode(compact);
  // New cards are stored by their separator-free form. Legacy cards were stored
  // with the single hyphen that followed QTA, so both hashes are accepted.
  const stored = formatted && /^QTA-[0-9A-F]{36}$/u.test(formatted) ? formatted : compact;
  return createHash('sha256').update(stored).digest('hex');
}

export function activationCodeDigests(value) {
  const compact = canonicalCompact(value);
  const formatted = formatActivationCode(compact);
  const hashes = new Set([activationCodeDigest(value)]);
  if (formatted) hashes.add(createHash('sha256').update(formatted).digest('hex'));
  if (compact) hashes.add(createHash('sha256').update(compact).digest('hex'));
  const trimmed = String(value ?? '').trim().toUpperCase();
  if (trimmed) hashes.add(createHash('sha256').update(trimmed).digest('hex'));
  return [...hashes];
}

export function mintActivationCode() {
  const bytes = randomBytes(GROUP * GROUPS);
  let body = '';
  for (let index = 0; index < GROUP * GROUPS; index += 1) body += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  return `QTA-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12)}`;
}

export const PRINTABLE_CODE = new RegExp(`^QTA(?:-[${CODE_ALPHABET}]{${GROUP}}){${GROUPS}}$`, 'u');
