import { pbkdf2, timingSafeEqual } from 'node:crypto';

const MIN_ITERATIONS = 310000;
const MAX_ITERATIONS = 600000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function derivePasswordHash(password, salt, iterations) {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, HASH_BYTES, 'sha256', (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4) return false;

  const [kind, roundsText, saltHex, expectedHex] = parts;
  if (kind !== 'pbkdf2' || !/^\d+$/.test(roundsText)) return false;

  const rounds = Number(roundsText);
  if (!Number.isSafeInteger(rounds) || rounds < MIN_ITERATIONS || rounds > MAX_ITERATIONS) return false;
  if (!new RegExp(`^[a-f0-9]{${SALT_BYTES * 2}}$`, 'i').test(saltHex)) return false;
  if (!new RegExp(`^[a-f0-9]{${HASH_BYTES * 2}}$`, 'i').test(expectedHex)) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await derivePasswordHash(String(password), salt, rounds);
  return timingSafeEqual(actual, expected);
}
