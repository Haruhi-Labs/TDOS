// 共享战斗 HUD 刷新:技能按钮/移动端HUD/全队舰况等纯展示逻辑,单人与在线共用。
// 约定:第一个参数是各模式 cacheDom 出的 ui 对象(id 已由 battle/template.js 统一),
// 战斗状态与选中信息全部显式传入,不读各模式的模块级变量。
import {
  AUTO_SCOUT_COOLDOWN_MULTIPLIER,
  EMERGENCY_BRAKE_COST,
  MANUAL_SCOUT_COOLDOWN,
  SCOUT_LAUNCH_COST,
  skillMetaForCharacter,
} from "../../shared/game-core.js";
import { EMERGENCY_BRAKE_COOLDOWN } from "../../shared/game/combat-rules.js";
import { shipCharacterName, slotLabel as localizedSlotLabel, t } from "../i18n.js";
import {
  clearCooldownProgress,
  mirrorCooldownProgress,
  setCooldownButtonLabel,
  setCooldownProgress,
} from "./cooldown-progress.js";
import { syncThrottleGearControls, throttleLabelForValue } from "./throttle.js";

const DESKTOP_COOLDOWN_BUTTON_KEYS = ["flagshipBtn", "subSkillBtn", "scoutBtn", "autoScoutBtn", "brakeBtn"];

function scoutCooldownDuration(remaining) {
  return remaining > MANUAL_SCOUT_COOLDOWN + 0.05
    ? MANUAL_SCOUT_COOLDOWN * AUTO_SCOUT_COOLDOWN_MULTIPLIER
    : MANUAL_SCOUT_COOLDOWN;
}

export function fleetSlotLabel(slotKey) {
  return localizedSlotLabel(slotKey, "short");
}

export function energyPercentForShip(ship) {
  const max = Math.max(1, Number(ship?.fleetMaxEnergy) || Number(ship?.maxEnergy) || 1);
  const value = Number(ship?.fleetEnergy) || Number(ship?.energy) || 0;
  return Math.round((value / max) * 100);
}

export function wxAnchorStatusLabel(own) {
  if (!own || !Object.values(own.loadout || {}).includes("wx_emperor")) return "—";
  const anchor = own?.wxAnchor;
  if (anchor?.active) {
    return t("驻锚中");
  }
  const overheat = Math.max(0, Number(anchor?.overheatRemaining) || 0);
  return overheat > 0 ? `${t("过热")} ${overheat.toFixed(1)}s` : t("驻锚待命");
}

export function updateWxAnchorStatus(ui, own) {
  if (!ui?.wxAnchorValue) return;
  ui.wxAnchorValue.textContent = wxAnchorStatusLabel(own);
  ui.wxAnchorValue.classList.toggle("wx-anchor-active", Boolean(own?.wxAnchor?.active));
  ui.wxAnchorValue.classList.toggle("wx-anchor-overheat", Number(own?.wxAnchor?.overheatRemaining) > 0);
}

export function wxAnchorSkillAvailability({ own, ship, meta, scope, energy = 0 } = {}) {
  const isWx = meta?.id === "imperial_anchor" && ship?.characterId === "wx_emperor";
  const active = Boolean(isWx && own?.wxAnchor?.active && own.wxAnchor.scope === scope);
  const overheatRemaining = isWx ? Math.max(0, Number(own?.wxAnchor?.overheatRemaining) || 0) : 0;
  return {
    isWx,
    active,
    overheatRemaining,
    entryBlocked: !active && (overheatRemaining > 0 || Number(energy) < (Number(meta?.cost) || 0)),
  };
}

// fallbackLoadout:快照/仿真尚未带 loadout 时用本地编队兜底
export function currentFlagshipMeta(own, fallbackLoadout) {
  const loadout = own && own.loadout ? own.loadout : fallbackLoadout;
  if (!loadout) {
    return null;
  }
  return skillMetaForCharacter(loadout.main, "flagship");
}

export function currentSubMeta(ship) {
  if (!ship || ship.key === "main") {
    return null;
  }
  return skillMetaForCharacter(ship.characterId, "sub");
}

// 技能区按钮(侦察/自动侦察/旗舰技/急刹/分舰技)的可用态与文案。
// opts: { selected 当前选中舰, selectedZoneId, pendingSubSkillAim, fallbackLoadout }
export function updateSkillButtons(ui, own, opts = {}) {
  const { selected = null, selectedZoneId, pendingSubSkillAim = null, fallbackLoadout = null } = opts;
  if (!own) {
    ui.scoutBtn.disabled = true;
    ui.autoScoutBtn.disabled = true;
    ui.autoScoutBtn.classList.remove("toggle-active");
    ui.brakeBtn.disabled = true;
    ui.flagshipBtn.disabled = true;
    ui.subSkillBtn.disabled = true;
    for (const key of DESKTOP_COOLDOWN_BUTTON_KEYS) {
      clearCooldownProgress(ui[key]);
    }
    return;
  }

  const cooldowns = own.cooldowns || {};
  const mainShip = own.ships ? own.ships.main : null;
  const mainEnergy = mainShip ? Number(mainShip.fleetEnergy) || 0 : 0;
  // 侦察机现从选中舰发出：按选中舰的可用能量判定是否可派
  const scoutEnergy = selected && selected.alive ? (Number(selected.fleetEnergy) || 0) : mainEnergy;

  const scoutLocked = own.skillsDisabled;
  ui.scoutBtn.disabled = scoutLocked || (cooldowns.scout || 0) > 0 || scoutEnergy < SCOUT_LAUNCH_COST;
  setCooldownButtonLabel(ui.scoutBtn, scoutLocked
    ? t("派出侦查机（已被封印）")
    : (cooldowns.scout || 0) > 0
      ? t("派出侦查机（冷却{seconds}秒）", { seconds: (cooldowns.scout || 0).toFixed(1) })
      : t("派出侦查机"));
  const scoutCooldown = Number(cooldowns.scout) || 0;
  const scoutDuration = scoutCooldownDuration(scoutCooldown);
  setCooldownProgress(ui.scoutBtn, scoutCooldown, scoutDuration, "scout");

  const autoScoutEnabled = Boolean(own.autoScout?.enabled);
  const autoScoutZoneId = Number(own.autoScout?.zoneId) || selectedZoneId;
  const autoScoutDisabled = own.skillsDisabled && !autoScoutEnabled;
  let autoScoutSuffix = autoScoutEnabled ? t("开·战区{zone}", { zone: autoScoutZoneId }) : t("关");
  if (autoScoutEnabled) {
    if ((cooldowns.scout || 0) > 0) {
      autoScoutSuffix += `·${t("冷却{seconds}秒", { seconds: (cooldowns.scout || 0).toFixed(1) })}`;
    } else if (mainEnergy < SCOUT_LAUNCH_COST) {
      autoScoutSuffix += `·${t("等待能量")}`;
    }
  } else if (own.skillsDisabled) {
    autoScoutSuffix = t("关·已封印");
  }
  ui.autoScoutBtn.disabled = autoScoutDisabled;
  setCooldownButtonLabel(ui.autoScoutBtn, t("自动侦查：{state}", { state: autoScoutSuffix }));
  ui.autoScoutBtn.classList.toggle("toggle-active", autoScoutEnabled);
  setCooldownProgress(ui.autoScoutBtn, autoScoutEnabled ? scoutCooldown : 0, scoutDuration, "auto-scout");

  const flagMeta = currentFlagshipMeta(own, fallbackLoadout);
  const wxFlagship = wxAnchorSkillAvailability({
    own,
    ship: mainShip,
    meta: flagMeta,
    scope: "fleet",
    energy: mainEnergy,
  });
  if (!flagMeta) {
    ui.flagshipBtn.disabled = true;
    setCooldownButtonLabel(ui.flagshipBtn, t("旗舰技能"));
  } else if (flagMeta.type === "passive") {
    ui.flagshipBtn.disabled = true;
    setCooldownButtonLabel(ui.flagshipBtn, t("旗舰技能：{name}{suffix}", { name: flagMeta.name, suffix: t("（被动）") }));
  } else {
    const flagshipCooldown = cooldowns.flagship || 0;
    const flagshipSilenced = Boolean(mainShip?.silenced);
    const isFuture1096FormSkill = flagMeta.id === "past_future_me";
    const currentFuture1096Form = own.future1096Form ? t(`${own.future1096Form}形态`) : t("无形态");
    const nextFuture1096Form = t(own.future1096Form === "A" ? "B形态" : "A形态");
    const disabled =
      own.skillsDisabled ||
      flagshipSilenced ||
      flagshipCooldown > 0 ||
      (wxFlagship.isWx ? wxFlagship.entryBlocked : mainEnergy < (flagMeta.cost || 0)) ||
      !(mainShip && mainShip.alive);
    ui.flagshipBtn.disabled = disabled;
    const suffix = flagshipSilenced
      ? t("（沉默中）")
      : wxFlagship.active
      ? t("（驻锚中·解除）")
      : wxFlagship.overheatRemaining > 0
        ? t("（过热{seconds}秒）", { seconds: wxFlagship.overheatRemaining.toFixed(1) })
      : isFuture1096FormSkill
      ? flagshipCooldown > 0
        ? t("（{current}·冷却{seconds}秒）", { current: currentFuture1096Form, seconds: flagshipCooldown.toFixed(1) })
        : t("（{current}→{next}）", { current: currentFuture1096Form, next: nextFuture1096Form })
      : flagshipCooldown > 0
        ? t("（冷却{seconds}秒）", { seconds: flagshipCooldown.toFixed(1) })
        : "";
    setCooldownButtonLabel(ui.flagshipBtn, t("旗舰技能：{name}{suffix}", { name: flagMeta.name, suffix }));
  }
  setCooldownProgress(
    ui.flagshipBtn,
    cooldowns.flagship,
    flagMeta?.type === "active" ? flagMeta.cooldown : 0,
    flagMeta?.id || "flagship",
  );

  const brakeCooldown = Number(selected?.brakeCooldown) || 0;
  const brakeEnergy = Number(selected?.fleetEnergy) || 0;
  const selectedWxAnchored = Boolean(
    selected
      && own.wxAnchor?.active
      && own.wxAnchor.shipKey === selected.key,
  );
  const brakeDisabled = !selected || !selected.alive || !selected.canControl || selected.attached || selected.koizumiOrb?.active || selectedWxAnchored || brakeCooldown > 0 || brakeEnergy < EMERGENCY_BRAKE_COST;
  let brakeSuffix = "";
  if (!selected || !selected.alive) {
    brakeSuffix = t("（切换到可控舰）");
  } else if (selected.koizumiOrb?.active) {
    brakeSuffix = selected.koizumiOrb.phase === "returning" ? t("（自动归航）") : t("（光球形态）");
  } else if (selectedWxAnchored) {
    brakeSuffix = t("（驻锚中）");
  } else if (!selected.canControl) {
    brakeSuffix = t("（切换到可控舰）");
  } else if (selected.attached) {
    brakeSuffix = t("（分离后可用）");
  } else if (brakeCooldown > 0) {
    brakeSuffix = t("（冷却{seconds}秒）", { seconds: brakeCooldown.toFixed(1) });
  } else if (brakeEnergy < EMERGENCY_BRAKE_COST) {
    brakeSuffix = t("（需{energy}能量）", { energy: EMERGENCY_BRAKE_COST });
  } else if (selected.braking) {
    brakeSuffix = t("（制动中）");
  }
  ui.brakeBtn.disabled = brakeDisabled;
  setCooldownButtonLabel(ui.brakeBtn, t("急刹{suffix}", { suffix: brakeSuffix }));
  setCooldownProgress(ui.brakeBtn, brakeCooldown, EMERGENCY_BRAKE_COOLDOWN, `brake:${selected?.key || "none"}`);

  const subMeta = currentSubMeta(selected);
  if (!selected || !subMeta) {
    ui.subSkillBtn.disabled = true;
    setCooldownButtonLabel(ui.subSkillBtn, t("分舰技能：切换到副舰后使用"));
    clearCooldownProgress(ui.subSkillBtn);
    return;
  }

  const skillEnergy = Number(selected.fleetEnergy) || 0;
  const cooldown = Number(cooldowns[selected.key] || 0);
  const detached = !selected.attached && selected.canControl;
  const wxSub = wxAnchorSkillAvailability({
    own,
    ship: selected,
    meta: subMeta,
    scope: "self",
    energy: skillEnergy,
  });
  const disabled = own.skillsDisabled
    || selected.silenced
    || selected.koizumiOrb?.active
    || !detached
    || cooldown > 0
    || (wxSub.isWx ? wxSub.entryBlocked : skillEnergy < (subMeta.cost || 0));

  let suffix = "";
  if (own.skillsDisabled) {
    suffix = t("（已被封印）");
  } else if (selected.silenced) {
    suffix = t("（沉默中）");
  } else if (selected.koizumiOrb?.active) {
    suffix = selected.koizumiOrb.phase === "returning" ? t("（自动归航）") : t("（光球形态）");
  } else if (!detached) {
    suffix = t("（分离后可用）");
  } else if (wxSub.active) {
    suffix = t("（驻锚中·解除）");
  } else if (wxSub.overheatRemaining > 0) {
    suffix = t("（过热{seconds}秒）", { seconds: wxSub.overheatRemaining.toFixed(1) });
  } else if (cooldown > 0) {
    suffix = t("（冷却{seconds}秒）", { seconds: cooldown.toFixed(1) });
  } else if (pendingSubSkillAim && pendingSubSkillAim.shipKey === selected.key) {
    suffix = subMeta.target === "optional_point" ? t("（地图点击闪现，再点按钮原地释放）") : t("（地图点击瞄准）");
  }
  ui.subSkillBtn.disabled = disabled;
  setCooldownButtonLabel(ui.subSkillBtn, t("分舰技能：{name}{suffix}", { name: subMeta.name, suffix }));
  setCooldownProgress(ui.subSkillBtn, cooldown, subMeta.cooldown, `${selected.key}:${subMeta.id}`);
}

// 移动端战斗 HUD:概要行/提示行/切舰按钮/动作按钮镜像/推进档位高亮。
// 桌面按钮的可用态先由 updateSkillButtons 算好,这里直接镜像,保证两处永远一致。
// opts: { visible, selected, selectedShipKey, selectedZoneId, pendingSubSkillAim }
export function syncMobileHud(ui, own, opts = {}) {
  const { visible = false, selected = null, selectedShipKey, selectedZoneId, pendingSubSkillAim = null } = opts;
  if (!ui.mobileBattleHud) {
    return;
  }
  ui.mobileBattleHud.hidden = !visible;
  if (!visible || !own) {
    return;
  }

  const shipName = selected ? shipCharacterName(selected) : t("无");
  const hullPercent = Math.round((own.hullRatio || 0) * 100);
  const anchorStatus = own?.wxAnchor?.active
    ? ` · ${t("驻锚中")}`
    : Number(own?.wxAnchor?.overheatRemaining) > 0
      ? ` · ${t("过热")}`
      : "";
  ui.mobileBattleSummary.textContent = `${shipName} · ${t("区")}${selectedZoneId} · ${t("体")}${hullPercent}% · ${throttleLabelForValue(selected?.throttle)}${anchorStatus}`;
  ui.mobileBattleHint.textContent = pendingSubSkillAim
    ? t("技能瞄准中：点战场确认，点右上小地图先挪镜头")
    : t("点舰船切换 · 点战场下航线 · 拖侦察选择战区");

  const buttonStates = {
    main: own.ships.main,
    sub1: own.ships.sub1,
    sub2: own.ships.sub2,
  };
  for (const button of ui.mobileShipButtons) {
    const ship = buttonStates[button.dataset.ship];
    const enabled = Boolean(ship && ship.alive && ship.canControl);
    button.disabled = !enabled;
    button.classList.toggle("active", button.dataset.ship === selectedShipKey);
  }

  ui.mobileSplitOneBtn.disabled = ui.splitOneBtn.disabled;
  ui.mobileSplitTwoBtn.disabled = ui.splitTwoBtn.disabled;
  ui.mobileScoutBtn.disabled = ui.scoutBtn.disabled;
  ui.mobileAutoScoutBtn.disabled = ui.autoScoutBtn.disabled;
  ui.mobileBrakeBtn.disabled = ui.brakeBtn.disabled;
  ui.mobileFlagshipBtn.disabled = ui.flagshipBtn.disabled;
  ui.mobileSubSkillBtn.disabled = ui.subSkillBtn.disabled;

  const autoScoutEnabled = Boolean(own.autoScout?.enabled);
  setCooldownButtonLabel(ui.mobileAutoScoutBtn, autoScoutEnabled ? t("自侦开") : t("自侦关"));
  ui.mobileAutoScoutBtn.classList.toggle("toggle-active", autoScoutEnabled);
  setCooldownButtonLabel(ui.mobileBrakeBtn, t("急刹"));
  const flagshipWxActive = own.loadout?.main === "wx_emperor" && own.wxAnchor?.active && own.wxAnchor.scope === "fleet";
  const subWxActive = selected?.characterId === "wx_emperor" && own.wxAnchor?.active && own.wxAnchor.scope === "self";
  setCooldownButtonLabel(ui.mobileFlagshipBtn, flagshipWxActive ? t("解除驻锚") : t("旗舰技"));
  setCooldownButtonLabel(ui.mobileSubSkillBtn, subWxActive
    ? t("解除驻锚")
    : selected && currentSubMeta(selected)
      ? currentSubMeta(selected).name
      : t("分舰技"));

  mirrorCooldownProgress(ui.scoutBtn, ui.mobileScoutBtn);
  mirrorCooldownProgress(ui.autoScoutBtn, ui.mobileAutoScoutBtn);
  mirrorCooldownProgress(ui.brakeBtn, ui.mobileBrakeBtn);
  mirrorCooldownProgress(ui.flagshipBtn, ui.mobileFlagshipBtn);
  mirrorCooldownProgress(ui.subSkillBtn, ui.mobileSubSkillBtn);

  syncThrottleGearControls(ui, selected?.throttle);
}

// 全队舰况：逐舰刷新血/能量条 + 状态，并高亮当前选中舰
export function renderFleetRoster(ui, own, opts = {}) {
  const { selectedShipKey } = opts;
  if (!ui.fleetRows) {
    return;
  }
  for (const cell of ui.fleetRows) {
    const ship = own && own.ships ? own.ships[cell.key] : null;
    cell.row.classList.toggle("active", cell.key === selectedShipKey);
    if (!ship) {
      cell.row.classList.add("gone");
      cell.name.textContent = fleetSlotLabel(cell.key);
      cell.state.textContent = "—";
      cell.state.classList.remove("danger");
      cell.hullFill.style.width = "0%";
      cell.enFill.style.width = "0%";
      cell.hullPct.textContent = "—";
      cell.enPct.textContent = "—";
      continue;
    }
    const dead = !ship.alive;
    const hull = dead ? 0 : Math.max(0, Math.round((Number(ship.hp) / Math.max(1, Number(ship.maxHp))) * 100));
    const energy = energyPercentForShip(ship);
    cell.row.classList.toggle("gone", dead);
    cell.name.textContent = `${fleetSlotLabel(cell.key)} ${shipCharacterName(ship)}`;
    let state = "";
    if (dead) {
      state = `✖ ${t("阵亡")}`;
    } else if (ship.braking) {
      state = t("急刹中");
    } else if (cell.key !== "main" && ship.attached === false) {
      state = t("分离中");
    }
    cell.state.textContent = state;
    cell.state.classList.toggle("danger", dead);
    cell.hullFill.style.width = `${hull}%`;
    cell.hullFill.classList.toggle("low", !dead && hull <= 30);
    cell.enFill.style.width = `${energy}%`;
    cell.hullPct.textContent = `${hull}%`;
    cell.enPct.textContent = `${energy}%`;
  }
}
