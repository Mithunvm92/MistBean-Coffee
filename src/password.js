import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const MIN_ITERATIONS = 310000;
const MAX_ITERATIONS = 600000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function fromHex(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4) return false;

  const [kind, roundsText, saltHex, expectedHex] = parts;
  if (kind !== 'pbkdf2' || !/^\\d+$/.test(roundsText)) return false;

  const rounds = Number(roundsText);
  if (!Number.isSafeInteger(rounds) || rounds < MIN_ITERATIONS || rounds > MAX_ITERATIONS) return false;
  if (!new RegExp(`^[a-f0-9]{${SALT_BYTES * 2}}$`, 'i').test(saltHex)) return false;
  if (!new RegExp(`^[a-f0-9]{${HASH_BYTES * 2}}$`, 'i').test(expectedHex)) return false;

  const salt = fromHex(saltHex);
  const expected = fromHex(expectedHex);
  const actual = await pbkdf2Async(sha256, String(password), salt, { c: rounds, dkLen: HASH_BYTES });

  // Constant-time comparison for equal-length derived keys.
  let difference = 0;
  for (let i = 0; i < HASH_BYTES; i += 1) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
