import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Used to keep login timing the same whether or not the email exists. */
export const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(16).toString('hex'));

/** Opaque bearer secret. Only its SHA-256 is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// No 0/O, 1/I/L, to make codes easy to read aloud and type on a phone.
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newPairingCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return code;
}
