import { createPublicKey, verify as verifySignature } from "node:crypto";

const EXPECTED_AUDIENCE = "haruhi-game-ws";
const EXPECTED_KEY_ID = "star-game-v1";
const MAX_TICKET_BYTES = 4096;
const MAX_TICKET_LIFETIME_SECONDS = 90;
const CLOCK_SKEW_SECONDS = 5;
const MAX_REPLAY_CACHE_ENTRIES = 10_000;

function decodeJson(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("invalid_encoding");
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function normalizeIssuer(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildPublicKey(rawKey) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawKey)) return null;
  try {
    return createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: rawKey },
      format: "jwk",
    });
  } catch (_error) {
    return null;
  }
}

export function createGameIdentityVerifier({ publicKey = "", issuers = [], now = Date.now } = {}) {
  const key = buildPublicKey(String(publicKey || "").trim());
  const allowedIssuers = new Set(issuers.map(normalizeIssuer).filter(Boolean));
  const usedTokenIds = new Map();

  function cleanup(nowSeconds) {
    for (const [tokenId, expiresAt] of usedTokenIds) {
      if (expiresAt + CLOCK_SKEW_SECONDS < nowSeconds) usedTokenIds.delete(tokenId);
    }
  }

  function fail(reason) {
    return { ok: false, reason };
  }

  function verifyAndConsume(ticket) {
    if (!key || allowedIssuers.size === 0) return fail("identity_disabled");
    if (typeof ticket !== "string" || !ticket || Buffer.byteLength(ticket) > MAX_TICKET_BYTES) {
      return fail("invalid_ticket");
    }
    const segments = ticket.split(".");
    if (segments.length !== 3 || segments.some((segment) => !segment)) return fail("invalid_ticket");

    let header;
    let claims;
    try {
      header = decodeJson(segments[0]);
      claims = decodeJson(segments[1]);
    } catch (_error) {
      return fail("invalid_ticket");
    }
    if (header.alg !== "EdDSA" || header.typ !== "JWT" || header.kid !== EXPECTED_KEY_ID) {
      return fail("invalid_header");
    }
    if (!/^[A-Za-z0-9_-]+$/.test(segments[2])) return fail("invalid_signature");
    const signature = Buffer.from(segments[2], "base64url");
    if (signature.length !== 64) return fail("invalid_signature");
    const validSignature = verifySignature(
      null,
      Buffer.from(`${segments[0]}.${segments[1]}`),
      key,
      signature,
    );
    if (!validSignature) return fail("invalid_signature");

    const nowSeconds = Math.floor(Number(now()) / 1000);
    const issuer = normalizeIssuer(claims.iss);
    if (!allowedIssuers.has(issuer) || claims.aud !== EXPECTED_AUDIENCE) {
      return fail("invalid_audience");
    }
    if (
      !Number.isInteger(claims.iat)
      || !Number.isInteger(claims.exp)
      || claims.exp <= nowSeconds - CLOCK_SKEW_SECONDS
      || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS
      || claims.exp <= claims.iat
      || claims.exp - claims.iat > MAX_TICKET_LIFETIME_SECONDS
      || claims.iat < nowSeconds - MAX_TICKET_LIFETIME_SECONDS - CLOCK_SKEW_SECONDS
    ) {
      return fail("expired_ticket");
    }
    const tokenId = String(claims.jti || "");
    const subject = String(claims.sub || "");
    const nickname = String(claims.nickname || "").replace(/\s+/g, " ").trim();
    const avatar = typeof claims.avatar === "string" ? claims.avatar.slice(0, 512) : null;
    if (
      !tokenId
      || tokenId.length > 128
      || !/^u\d+$/.test(subject)
      || !nickname
      || [...nickname].length > 32
    ) {
      return fail("invalid_claims");
    }

    cleanup(nowSeconds);
    if (usedTokenIds.has(tokenId)) return fail("replayed_ticket");
    if (usedTokenIds.size >= MAX_REPLAY_CACHE_ENTRIES) return fail("replay_cache_full");
    usedTokenIds.set(tokenId, claims.exp);
    return {
      ok: true,
      identity: { id: subject, nickname, avatar },
    };
  }

  return { enabled: Boolean(key && allowedIssuers.size), verifyAndConsume };
}
