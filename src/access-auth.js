import {
  customFetch,
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify
} from 'jose';

const JWKS_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const JWKS_CACHE = new WeakMap();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function audienceMatches(claim, expected) {
  const values = Array.isArray(claim) ? claim : [claim];
  return values.includes(expected);
}

function safeHeader(token) {
  try {
    const header = decodeProtectedHeader(token);
    return {
      kid: typeof header.kid === 'string' ? header.kid.slice(0, 128) : null,
      alg: typeof header.alg === 'string' ? header.alg : null
    };
  } catch {
    return { kid: null, alg: null };
  }
}

function safeClaimDiagnostics(token, issuer, audience) {
  try {
    const payload = decodeJwt(token);
    return {
      issuerMatches: payload.iss === issuer,
      audienceMatches: audienceMatches(payload.aud, audience)
    };
  } catch {
    return { issuerMatches: false, audienceMatches: false };
  }
}

function diagnostic(logger, category, details = {}) {
  const event = { category, ...details };
  const method = category === 'verified' ? 'info' : 'warn';
  try {
    (logger?.[method] || (() => {})).call(logger, 'ACCESS_DIAG', event);
  } catch {
    // Diagnostics must never affect authentication decisions.
  }
}

function classifyError(error, jwksFetchFailed) {
  const code = error?.code;
  if (jwksFetchFailed) return 'jwks_fetch_failed';
  if (code === 'ERR_JWKS_NO_MATCHING_KEY') return 'unknown_kid';
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return 'bad_signature';
  if (code === 'ERR_JWT_EXPIRED') return 'expired';
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
    if (error?.claim === 'iss') return 'wrong_issuer';
    if (error?.claim === 'aud') return 'wrong_audience';
    if (error?.claim === 'nbf') return 'not_before';
  }
  if (code === 'ERR_JWS_INVALID' || code === 'ERR_JWT_INVALID' ||
      code === 'ERR_JOSE_ALG_NOT_ALLOWED' || code === 'ERR_JWS_VERIFICATION_FAILED') {
    return 'malformed';
  }
  return 'malformed';
}

function createResolver(issuer, fetcher) {
  let fetchFailed = false;
  const guardedFetch = async (...args) => {
    try {
      const response = await fetcher(...args);
      if (!response?.ok) {
        fetchFailed = true;
        throw new Error('JWKS endpoint returned a non-success status');
      }
      return response;
    } catch (error) {
      fetchFailed = true;
      throw error;
    }
  };
  const resolver = createRemoteJWKSet(
    new URL(issuer + '/cdn-cgi/access/certs'),
    {
      [customFetch]: guardedFetch,
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
      cooldownDuration: 0,
      timeoutDuration: 5000
    }
  );
  return { resolver, fetchFailed: () => fetchFailed };
}

function getResolverCache(fetcher) {
  let cache = JWKS_CACHE.get(fetcher);
  if (!cache) {
    cache = new Map();
    JWKS_CACHE.set(fetcher, cache);
  }
  return cache;
}

export async function verifyAccess(request, env, options = {}) {
  const issuer = String(env.ACCESS_TEAM_DOMAIN || '').replace(/\/+$/, '');
  const audience = String(env.ACCESS_AUD || '').trim();
  const allowedEmail = normalizeEmail(env.ADMIN_EMAIL);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const logger = options.logger || console;

  if (!issuer || !audience || !allowedEmail) {
    diagnostic(logger, 'missing_config', {
      issuerConfigured: Boolean(issuer),
      audienceConfigured: Boolean(audience),
      adminEmailConfigured: Boolean(allowedEmail)
    });
    return null;
  }
  if (!token) {
    diagnostic(logger, 'missing_assertion');
    return null;
  }

  const header = safeHeader(token);
  const claims = safeClaimDiagnostics(token, issuer, audience);
  if (header.alg !== 'RS256' || !header.kid) {
    diagnostic(logger, 'malformed', {
      kid: header.kid,
      issuerMatches: claims.issuerMatches,
      audienceMatches: claims.audienceMatches
    });
    return null;
  }

  const fetcher = options.fetcher || fetch;
  const cache = getResolverCache(fetcher);
  let entry = cache.get(issuer);
  if (!entry) {
    entry = createResolver(issuer, fetcher);
    cache.set(issuer, entry);
  }

  const verifyOptions = {
    issuer,
    audience,
    algorithms: ['RS256'],
    clockTolerance: 60
  };
  if (options.now) verifyOptions.currentDate = options.now;

  try {
    let verified;
    try {
      verified = await jwtVerify(token, entry.resolver, verifyOptions);
    } catch (firstError) {
      if (firstError?.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw firstError;
      entry = createResolver(issuer, fetcher);
      cache.set(issuer, entry);
      try {
        verified = await jwtVerify(token, entry.resolver, verifyOptions);
      } catch (retryError) {
        const category = classifyError(retryError, entry.fetchFailed());
        diagnostic(logger, category, {
          kid: header.kid,
          issuerMatches: claims.issuerMatches,
          audienceMatches: claims.audienceMatches
        });
        return null;
      }
    }

    const email = normalizeEmail(verified.payload.email);
    if (!email || email !== allowedEmail) {
      diagnostic(logger, 'email_mismatch', {
        kid: header.kid,
        emailClaimPresent: Boolean(email),
        emailMatchesConfiguredAdmin: Boolean(email && email === allowedEmail)
      });
      return null;
    }

    diagnostic(logger, 'verified', { kid: header.kid });
    return { email };
  } catch (error) {
    const category = classifyError(error, entry.fetchFailed());
    diagnostic(logger, category, {
      kid: header.kid,
      issuerMatches: claims.issuerMatches,
      audienceMatches: claims.audienceMatches
    });
    return null;
  }
}
