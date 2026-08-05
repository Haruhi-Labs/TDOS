const COOLDOWN_RESTART_EPSILON = 0.12;
const cooldownStateByButton = new WeakMap();

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function cooldownProgressRatio(remaining, duration) {
  const safeRemaining = finiteNonNegative(remaining);
  const safeDuration = finiteNonNegative(duration);
  if (safeRemaining <= 0 || safeDuration <= 0) {
    return 0;
  }
  return Math.min(1, safeRemaining / safeDuration);
}

// 同一轮冷却跨过推断阈值时保留最初总时长；剩余时间上跳则视为新一轮冷却。
export function resolveCooldownDuration({
  remaining,
  suggestedDuration,
  previousRemaining = 0,
  previousDuration = 0,
  active = false,
} = {}) {
  const safeRemaining = finiteNonNegative(remaining);
  if (safeRemaining <= 0) {
    return 0;
  }
  const safeSuggested = finiteNonNegative(suggestedDuration);
  const safePreviousRemaining = finiteNonNegative(previousRemaining);
  const safePreviousDuration = finiteNonNegative(previousDuration);
  const sameCycle = active && safeRemaining <= safePreviousRemaining + COOLDOWN_RESTART_EPSILON;
  if (sameCycle) {
    return Math.max(safePreviousDuration, safeSuggested, safeRemaining);
  }
  return Math.max(safeSuggested, safeRemaining);
}

export function setCooldownButtonLabel(button, text) {
  if (!button) return;
  const label = button.querySelector(":scope > .cooldown-button-label");
  if (label) {
    label.textContent = text;
  } else {
    button.textContent = text;
  }
}

export function clearCooldownProgress(button) {
  if (!button) return;
  button.classList.remove("has-cooldown-progress");
  button.style.removeProperty("--cooldown-progress");
  cooldownStateByButton.delete(button);
}

export function setCooldownProgress(button, remaining, suggestedDuration, cycleKey = "") {
  if (!button) return 0;
  const safeRemaining = finiteNonNegative(remaining);
  if (safeRemaining <= 0) {
    clearCooldownProgress(button);
    return 0;
  }

  const previous = cooldownStateByButton.get(button);
  const duration = resolveCooldownDuration({
    remaining: safeRemaining,
    suggestedDuration,
    previousRemaining: previous?.remaining,
    previousDuration: previous?.duration,
    active: button.classList.contains("has-cooldown-progress")
      && previous?.cycleKey === String(cycleKey),
  });
  const ratio = cooldownProgressRatio(safeRemaining, duration);
  cooldownStateByButton.set(button, {
    remaining: safeRemaining,
    duration,
    cycleKey: String(cycleKey),
    ratio,
  });
  const visualRatio = ratio.toFixed(4);
  if (button.style.getPropertyValue("--cooldown-progress") !== visualRatio) {
    button.style.setProperty("--cooldown-progress", visualRatio);
  }
  button.classList.add("has-cooldown-progress");
  return ratio;
}

export function mirrorCooldownProgress(source, target) {
  if (!source || !target) return;
  if (!source.classList.contains("has-cooldown-progress")) {
    clearCooldownProgress(target);
    return;
  }
  const sourceState = cooldownStateByButton.get(source);
  if (sourceState) {
    cooldownStateByButton.set(target, { ...sourceState });
  }
  const visualRatio = source.style.getPropertyValue("--cooldown-progress") || "0";
  if (target.style.getPropertyValue("--cooldown-progress") !== visualRatio) {
    target.style.setProperty("--cooldown-progress", visualRatio);
  }
  target.classList.add("has-cooldown-progress");
}
