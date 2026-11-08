import { pbkdf2Sync, randomBytes } from 'node:crypto';
const password = process.argv[2];
if (!password || password.length < 14) {
  console.error('Usage: npm run admin:hash -- "a-unique-password-at-least-14-chars"');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 310000, 32, 'sha256').toString('hex');
console.log(`pbkdf2$310000$${salt}$${hash}`);
