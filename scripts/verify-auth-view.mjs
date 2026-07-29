import assert from "node:assert/strict";

let validateRegistration;
try {
  ({ validateRegistration } = await import("../src/auth-view.js"));
} catch (_error) {
  // The initial RED run intentionally reaches this branch before the view exists.
}

assert.equal(typeof validateRegistration, "function", "auth view should export validateRegistration(input)");

assert.deepEqual(
  validateRegistration({ password: "short", confirmPassword: "short" }),
  { valid: false, code: "invalid_password" },
  "registration should reject passwords outside the account password length",
);
assert.deepEqual(
  validateRegistration({ password: "strong-password-123", confirmPassword: "different-password-123" }),
  { valid: false, code: "password_mismatch" },
  "registration should reject mismatched password confirmation before an API request",
);
assert.deepEqual(
  validateRegistration({ password: "strong-password-123", confirmPassword: "strong-password-123" }),
  { valid: true, code: null },
  "registration should allow matching passwords in the supported range",
);

console.log("auth view validation passed");
