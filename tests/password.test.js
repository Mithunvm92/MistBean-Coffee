import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { verifyPassword } from '../src/password.js';

const password = 'Correct-Horse-Battery-42!';
const salt = '0123456789abcdef0123456789abcdef';
const rounds = 310000;

function storedHash(value = password, iterations = rounds) {
  const hash = pbkdf2Sync(value, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

test('verifies existing PBKDF2-SHA256 hashes at 310000 iterations', async () => {
  assert.equal(await verifyPassword(password, storedHash()), true);
});

test('rejects an incorrect password for a valid PBKDF2 hash', async () => {
  assert.equal(await verifyPassword('Incorrect-password-42!', storedHash()), false);
});

test('rejects malformed or unsupported password hash records safely', async () => {
  assert.equal(await verifyPassword(password, ''), false);
  assert.equal(await verifyPassword(password, 'pbkdf2$310000$bad$bad'), false);
  assert.equal(await verifyPassword(password, storedHash(password, 700000)), false);
  assert.equal(await verifyPassword(password, 'argon2id$invalid'), false);
});
