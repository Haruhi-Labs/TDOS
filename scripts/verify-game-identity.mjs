import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createGameIdentityVerifier } from "../server/game-identity.js";

const NOW_SECONDS = 1_800_000_000;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicJwk = publicKey.export({ format: "jwk" });

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function issueTicket(overrides = {}) {
  const header = encode({ alg: "EdDSA", typ: "JWT", kid: "star-game-v1" });
  const claims = encode({
    iss: "https://haruyuki.cn",
    sub: "u42",
    aud: "haruhi-game-ws",
    nickname: "测试指挥官",
    avatar: "/uploads/avatars/u42-test.webp",
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 60,
    jti: `ticket-${Math.random()}`,
    ...overrides,
  });
  const input = `${header}.${claims}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString("base64url")}`;
}

function verifier() {
  return createGameIdentityVerifier({
    publicKey: publicJwk.x,
    issuers: ["https://haruyuki.cn"],
    now: () => NOW_SECONDS * 1000,
  });
}

const validVerifier = verifier();
const validTicket = issueTicket({ jti: "valid-once" });
const valid = validVerifier.verifyAndConsume(validTicket);
assert.equal(valid.ok, true, "合法 Ed25519 游戏票据应通过");
assert.deepEqual(valid.identity, {
  id: "u42",
  nickname: "测试指挥官",
  avatar: "/uploads/avatars/u42-test.webp",
});
assert.equal(
  validVerifier.verifyAndConsume(validTicket).reason,
  "replayed_ticket",
  "同一 jti 只能消费一次",
);

assert.equal(
  verifier().verifyAndConsume(issueTicket({ aud: "another-service" })).reason,
  "invalid_audience",
  "票据 audience 必须精确匹配联机服务",
);
assert.equal(
  verifier().verifyAndConsume(issueTicket({ exp: NOW_SECONDS - 10 })).reason,
  "expired_ticket",
  "过期票据必须拒绝",
);
const tampered = issueTicket({ jti: "tampered" });
const replacement = tampered.endsWith("A") ? "B" : "A";
assert.equal(
  verifier().verifyAndConsume(`${tampered.slice(0, -1)}${replacement}`).ok,
  false,
  "篡改签名必须拒绝",
);
assert.equal(
  createGameIdentityVerifier({ issuers: ["https://haruyuki.cn"] }).enabled,
  false,
  "缺少公钥时只关闭统一身份，不影响游客服务启动",
);

console.log("统一身份票据校验通过：签名、受众、时效与 jti 防重放均生效。");
