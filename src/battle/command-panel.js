import { SCOUT_LAUNCH_COST, skillMetaForCharacter } from "../../shared/game-core.js";
import { shipCharacterName, skillText, slotLabel, t } from "../i18n.js";
import { getPortraitAssetUrl } from "../character-select/portraits.js";
import { isShipControlLocked } from "./ship-selection.js";

const partsByButton = new WeakMap();
function parts(button) {
  if (!button) return null;
  if (!partsByButton.has(button)) {
    const title = button.querySelector(".command-action-title");
    partsByButton.set(button, title ? {
      title, kind: button.querySelector(".command-action-kind"), state: button.querySelector(".command-action-state"), cost: button.querySelector(".command-action-cost"),
    } : null);
  }
  return partsByButton.get(button);
}

function text(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function display(button, name, state, cost = "", description = "") {
  const nodes = parts(button);
  if (!nodes) return;
  text(nodes.title, name);
  text(nodes.state, state);
  text(nodes.cost, cost);
  button.dataset.ready = String(!button.disabled);
  button.setAttribute("aria-label", [nodes.kind?.textContent, name, state, cost].filter(Boolean).join(" · "));
  button.title = description;
}

function skillStatus(team, ship, meta, cooldown, pendingAim) {
  if (!ship?.alive) return t("已击沉");
  if (meta?.type === "passive") {
    const barrier = meta.id === "closed_space_barrier" ? team.koizumiBarrier : null;
    return barrier ? barrier.active
      ? t("护盾 {count}/{max}", { count: barrier.remainingHits, max: barrier.maxHits })
      : t("修复{seconds}秒", { seconds: Number(barrier.disabledRemaining).toFixed(1) }) : t("被动");
  }
  if (team.skillsDisabled) return t("已封印");
  if (isShipControlLocked(ship)) return t(ship.stunRemaining > 0 ? "眩晕" : "不可操控");
  if (ship.silenced) return t("沉默中");
  if (ship.koizumiOrb?.active) return ship.koizumiOrb.phase === "returning" ? t("自动归航") : t("光球形态");
  if (ship.attached) return t("分离后可用");
  if (!ship.canControl) return t("不可操控");
  if (cooldown > 0) return `${meta?.id === "past_future_me" ? `${team.future1096Form || "—"} · ` : ""}${Number(cooldown).toFixed(1)}s`;
  if ((ship.fleetEnergy ?? ship.energy ?? 0) < (meta?.cost || 0)) return t("能量不足");
  if (pendingAim?.shipKey === ship.key) return t("点击战场瞄准");
  if (meta?.id === "past_future_me") return `${team.future1096Form || "—"} → ${team.future1096Form === "A" ? "B" : "A"}`;
  return t("就绪");
}

// 只呈现共享 HUD 已算出的可用状态，不发动作、不改快照或模拟。
export function renderCommandPanel(ui, own, { selected, pendingSubSkillAim, fallbackLoadout, selectedZoneId } = {}) {
  if (!own) return;
  const main = own.ships?.main;
  const mainId = main?.characterId || own.loadout?.main || fallbackLoadout?.main;
  const flag = mainId ? skillMetaForCharacter(mainId, "flagship") : null;
  const sub = selected?.key !== "main" && selected?.characterId ? skillMetaForCharacter(selected.characterId, "sub") : null;
  const cost = (meta) => meta?.type === "active" ? t("{energy}能量", { energy: meta.cost || 0 }) : "";
  display(ui.flagshipBtn, flag ? skillText(mainId, "flagship") : t("旗舰技能"), flag ? skillStatus(own, main, flag, own.cooldowns?.flagship, null) : "—", flag ? cost(flag) : "", mainId ? skillText(mainId, "flagship", "description") : "");
  display(ui.subSkillBtn, sub ? skillText(selected.characterId, "sub") : t("分舰技能"), sub ? skillStatus(own, selected, sub, own.cooldowns?.[selected.key], pendingSubSkillAim) : t("先选择副舰"), sub ? cost(sub) : "", sub ? skillText(selected.characterId, "sub", "description") : "");
  const flagKey = ui.flagshipBtn.querySelector("kbd");
  if (flagKey) flagKey.hidden = flag?.type === "passive";
  const scoutRemaining = Number(own.cooldowns?.scout) || 0;
  const scoutEnergy = selected?.alive ? selected.fleetEnergy : main?.fleetEnergy;
  display(ui.scoutBtn, t("侦察"), own.skillsDisabled ? t("已封印") : isShipControlLocked(selected || main) ? t((selected || main).stunRemaining > 0 ? "眩晕" : "不可操控") : scoutRemaining > 0 ? `${scoutRemaining.toFixed(1)}s` : scoutEnergy < SCOUT_LAUNCH_COST ? t("能量不足") : t("战区{zone}", { zone: selectedZoneId }), t("{energy}能量", { energy: SCOUT_LAUNCH_COST }));
  const auto = Boolean(own.autoScout?.enabled);
  display(ui.autoScoutBtn, t("自动侦察"), auto ? scoutRemaining > 0 ? `${scoutRemaining.toFixed(1)}s` : Number(main?.fleetEnergy) < SCOUT_LAUNCH_COST ? t("等待能量") : t("战区{zone}", { zone: own.autoScout.zoneId }) : own.skillsDisabled ? t("已封印") : t("已关闭"), auto ? t("已开启") : "");
  ui.autoScoutBtn.setAttribute("aria-pressed", String(auto));
  const root = ui.flagshipBtn.closest?.(".battle-shell");
  text(root?.querySelector("#commandSelectedShip"), selected ? shipCharacterName(selected) : "—");
  const hint = root?.querySelector("#commandContextHint");
  const hintText = pendingSubSkillAim ? sub?.target === "optional_point" ? t("点战场闪现；再次点技能原地释放") : t("点击战场确认技能目标") : "";
  text(hint, hintText);
  if (hint) hint.hidden = !hintText;
}

export function mirrorCommandButton(source, target) {
  const nodes = parts(source);
  if (!nodes) return;
  display(target, nodes.title.textContent, nodes.state.textContent, nodes.cost.textContent, source.title);
  const label = target?.querySelector(".cooldown-button-label");
  text(label, source.querySelector(".cooldown-button-label")?.textContent || nodes.title.textContent);
  if (source.hasAttribute("aria-pressed")) target?.setAttribute("aria-pressed", source.getAttribute("aria-pressed"));
}

export function renderCommandShip(row, ship, key, team, portraitColor) {
  const img = row.querySelector?.(".command-portrait img");
  if (!img) return;
  const character = ship?.characterId || "";
  const color = portraitColor || (team?.seat === "B" ? "red" : "blue");
  const asset = character ? getPortraitAssetUrl(character, color) : "";
  if (img.getAttribute("src") !== asset) {
    if (asset) img.src = asset;
    else img.removeAttribute("src");
    img.hidden = !asset;
  }
  row.setAttribute("aria-pressed", String(row.classList.contains("active")));
  row.title = `${slotLabel(key, "short")} · ${ship ? shipCharacterName(ship) : "—"}`;
}
