export const RULESET_VERSION = "ruleset-20260805-07";

export function evaluateRulesetCompatibility(remoteVersion, localVersion = RULESET_VERSION) {
  const local = String(localVersion || "").trim();
  const remote = String(remoteVersion || "").trim();
  if (!remote) {
    return {
      compatible: true,
      status: "legacy",
      localVersion: local,
      remoteVersion: "",
    };
  }
  return {
    compatible: remote === local,
    status: remote === local ? "compatible" : "mismatch",
    localVersion: local,
    remoteVersion: remote,
  };
}
