import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { verifyAccess } from '../src/access-auth.js';
import worker from '../src/index.js';

const ISSUER = 'https://access-auth-tests.example.cloudflareaccess.com';
const AUDIENCE = 'test-access-audience';
const EMAIL = 'admin@example.test';
const NOW = new Date('2026-11-15T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

async function keys(kid = 'test-key') {
  const pair = await generateKeyPair('RS256', { modulusLength: 2048 });
  const jwk = await exportJWK(pair.publicKey);
  Object.assign(jwk, { kid, alg: 'RS256', use: 'sig' });
  return { ...pair, jwk };
}

async function token(privateKey, overrides = {}, kid = 'test-key') {
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    email: EMAIL,
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 300,
    ...overrides
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .sign(privateKey);
}

function makeLogger() {
  const events = [];
  return {
    events,
    info: (_message, event) => events.push(event),
    warn: (_message, event) => events.push(event)
  };
}

function makeFetcher(jwks, onFetch = () => {}) {
  return async (url) => {
    onFetch(String(url));
    return new Response(JSON.stringify(jwks), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  };
}

function makeRequest(assertion) {
  const headers = new Headers({ cookie: 'session-cookie-secret' });
  if (assertion !== undefined) headers.set('Cf-Access-Jwt-Assertion', assertion);
  return new Request('https://staging.example.test/api/admin/orders', { headers });
}

function makeEnv(overrides = {}) {
  return {
    ACCESS_TEAM_DOMAIN: ISSUER,
    ACCESS_AUD: AUDIENCE,
    ADMIN_EMAIL: EMAIL,
    ...overrides
  };
}

test('accepts a valid RS256 Access assertion and normalizes email', async () => {
  const pair = await keys();
  const assertion = await token(pair.privateKey, { email: ' Admin@Example.Test ' });
  const logger = makeLogger();
  const identity = await verifyAccess(makeRequest(assertion), makeEnv(), {
    fetcher: makeFetcher({ keys: [pair.jwk] }), logger, now: NOW
  });
  assert.deepEqual(identity, { email: EMAIL });
  assert.equal(logger.events.at(-1).category, 'verified');
});

test('rejects a wrong audience', async () => {
  const pair = await keys();
  const assertion = await token(pair.privateKey, { aud: 'different-audience' });
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest(assertion), makeEnv(), {
    fetcher: makeFetcher({ keys: [pair.jwk] }), logger, now: NOW
  }), null);
  assert.equal(logger.events.at(-1).category, 'wrong_audience');
});

test('rejects a wrong issuer', async () => {
  const pair = await keys();
  const assertion = await token(pair.privateKey, { iss: 'https://wrong.example.test' });
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest(assertion), makeEnv(), {
    fetcher: makeFetcher({ keys: [pair.jwk] }), logger, now: NOW
  }), null);
  assert.equal(logger.events.at(-1).category, 'wrong_issuer');
});

test('rejects an expired assertion', async () => {
  const pair = await keys();
  const assertion = await token(pair.privateKey, { exp: NOW_SECONDS - 120 });
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest(assertion), makeEnv(), {
    fetcher: makeFetcher({ keys: [pair.jwk] }), logger, now: NOW
  }), null);
  assert.equal(logger.events.at(-1).category, 'expired');
});

test('rejects an assertion whose not-before time is in the future', async () => {
  const pair = await keys();
  const assertion = await token(pair.privateKey, { nbf: NOW_SECONDS + 120 });
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest(assertion), makeEnv(), {
    fetcher: makeFetcher({ keys: [pair.jwk] }), logger, now: NOW
  }), null);
  assert.equal(logger.events.at(-1).category, 'not_before');
});

test('rejects a bad signature', async () => {
  const trusted = await keys();
  const attacker = await keys();
  const assertion = await token(attacker.privateKey, {}, 'test-key');
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest(assertion), makeEnv(), {
    fetcher: makeFetcher({ keys: [trusted.jwk] }), logger, now: NOW
  }), null);
  assert.equal(logger.events.at(-1).category, 'bad_signature');
});

test('refreshes JWKS once and rejects an unknown kid', async () => {
  const pair = await keys('known-key');
  const assertion = await token(pair.privateKey, {}, 'unknown-key');
  let fetchCount = 0;
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest(assertion), makeEnv(), {
    fetcher: makeFetcher({ keys: [pair.jwk] }, () => fetchCount++), logger, now: NOW
  }), null);
  assert.equal(fetchCount, 2);
  assert.equal(logger.events.at(-1).category, 'unknown_kid');
});

test('rejects a missing assertion', async () => {
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest(), makeEnv(), { logger }), null);
  assert.equal(logger.events.at(-1).category, 'missing_assertion');
});

test('rejects malformed JWT input', async () => {
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest('not.a.jwt'), makeEnv(), { logger }), null);
  assert.equal(logger.events.at(-1).category, 'malformed');
});

test('rejects an email mismatch', async () => {
  const pair = await keys();
  const assertion = await token(pair.privateKey, { email: 'other@example.test' });
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest(assertion), makeEnv(), {
    fetcher: makeFetcher({ keys: [pair.jwk] }), logger, now: NOW
  }), null);
  assert.equal(logger.events.at(-1).category, 'email_mismatch');
});

test('rejects missing configuration', async () => {
  const logger = makeLogger();
  assert.equal(await verifyAccess(makeRequest('anything'), makeEnv({ ADMIN_EMAIL: '' }), { logger }), null);
  assert.equal(logger.events.at(-1).category, 'missing_config');
});

test('does not log assertions, cookies, or raw email addresses', async () => {
  const pair = await keys();
  const assertion = await token(pair.privateKey, { email: 'private-person@example.test' });
  const logger = makeLogger();
  await verifyAccess(makeRequest(assertion), makeEnv({ ADMIN_EMAIL: 'different@example.test' }), {
    fetcher: makeFetcher({ keys: [pair.jwk] }), logger, now: NOW
  });
  const output = JSON.stringify(logger.events);
  assert.equal(output.includes(assertion), false);
  assert.equal(output.includes('session-cookie-secret'), false);
  assert.equal(output.includes('private-person@example.test'), false);
  assert.equal(output.includes('different@example.test'), false);
});

test('rejects a JWKS fetch failure without exposing the underlying error', async () => {
  const pair = await keys();
  const assertion = await token(pair.privateKey);
  const logger = makeLogger();
  const fetcher = async () => { throw new Error('network failure with private detail'); };
  assert.equal(await verifyAccess(makeRequest(assertion), makeEnv(), {
    fetcher, logger, now: NOW
  }), null);
  assert.equal(logger.events.at(-1).category, 'jwks_fetch_failed');
  assert.equal(JSON.stringify(logger.events).includes('private detail'), false);
});

test('Worker returns 401 for an admin API request without an Access assertion', async () => {
  const response = await worker.fetch(makeRequest(), makeEnv());
  assert.equal(response.status, 401);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('Worker allows a valid Access assertion to reach the admin API handler', async () => {
  const pair = await keys();
  const assertion = await token(pair.privateKey);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetcher({ keys: [pair.jwk] });
  try {
    const DB = {
      prepare() {
        return {
          bind() { return this; },
          async all() { return { results: [{ id: 'test-order' }] }; }
        };
      }
    };
    const request = makeRequest(assertion);
    const response = await worker.fetch(request, makeEnv({ DB }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { orders: [{ id: 'test-order' }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
