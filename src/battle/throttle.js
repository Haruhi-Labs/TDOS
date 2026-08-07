import {
  THROTTLE_GEAR_VALUES,
  throttleForGear,
  throttleGearForValue,
} from "../../shared/game-core.js";
import { t } from "../i18n.js";

export function throttleGearLabel(gear) {
  const safeGear = Math.max(0, Math.min(THROTTLE_GEAR_VALUES.length - 1, Math.round(Number(gear) || 0)));
  return safeGear === 0 ? t("P档") : t("前进{gear}", { gear: safeGear });
}

export function throttleLabelForValue(throttle) {
  return throttleGearLabel(throttleGearForValue(throttle));
}

export function syncThrottleGearControls(ui, throttle) {
  const gear = throttleGearForValue(throttle);
  if (ui.powerValue) {
    ui.powerValue.textContent = throttleGearLabel(gear);
  }
  for (const button of [...(ui.powerGearButtons || []), ...(ui.mobileThrottleButtons || [])]) {
    const active = Number(button.dataset.gear) === gear;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  return gear;
}

// 单人动作会先更新本地权威模拟，显示快照要到下一个固定逻辑帧才刷新。
// 控制链必须优先读取模拟舰船，否则同帧续设航线会把旧显示档位写回权威状态。
export function localThrottleForShip(simulatedShip, renderedShip = null) {
  const throttle = simulatedShip?.throttle ?? renderedShip?.throttle;
  return throttleValueForGear(throttleGearForValue(throttle));
}

// 保留现有 1/2/3 切舰快捷键：档位直达使用 Shift+1–4，Q/E 用于逐档切换。
export function throttleGearFromShortcut(event, currentThrottle) {
  if (!event || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  if (event.code === "KeyP") {
    return 0;
  }
  if (event.shiftKey) {
    const directGear = {
      Digit1: 1,
      Digit2: 2,
      Digit3: 3,
      Digit4: 4,
    }[event.code];
    return directGear ?? null;
  }
  const currentGear = throttleGearForValue(currentThrottle);
  if (event.code === "KeyQ") {
    return Math.max(0, currentGear - 1);
  }
  if (event.code === "KeyE") {
    return Math.min(THROTTLE_GEAR_VALUES.length - 1, currentGear + 1);
  }
  return null;
}

export function throttleValueForGear(gear) {
  return throttleForGear(gear);
}
