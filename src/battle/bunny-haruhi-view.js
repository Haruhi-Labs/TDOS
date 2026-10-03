import { skillMetaForCharacter } from "../../shared/game/characters.js";
import { BUNNY_HARUHI_CONFIG as C } from "../../shared/game/bunny-haruhi-config.js";
import { BUNNY_VIEW_PARAMS } from "../../shared/game/bunny-haruhi-view-params.js";
import { STATUS_EFFECT_DEFS } from "../../shared/game/status-effect-definitions.js";
import { skillText, t } from "../i18n.js";

export function battleSkillMeta(id, mode) {
  if (id !== C.characterId) return skillMetaForCharacter(id, mode);
  return mode === "flagship"
    ? { id: C.flagshipSkillId, name: skillText(id, mode), type: "passive", cost: 0 }
    : { id: C.subSkillId, name: skillText(id, mode), type: "active", cost: C.form.energyCost, cooldown: C.form.cooldownSeconds, target: C.form.target };
}

export function bunnyFormLabel(form) {
  return ({ neutral: t("未变身"), bless: "God bless…", knows: "God Knows…", encore: t("激奏") })[form] || t("未变身");
}

export function bunnyBlockLabel(ship, team) {
  const reason = ship?.bunnyHaruhi?.blockReason;
  const labels = { invalid_slot: t("舞台·被动"), dead: t("已击沉"), attached: t("分离后可用"),
    control_locked: t("不可操控"), silenced: t("沉默"), skills_disabled: t("已封印"),
    insufficient_hp: t("生命需高于{cost}%上限", BUNNY_VIEW_PARAMS),
    cooldown: t("冷却{seconds}秒", { seconds: Number(team?.cooldowns?.[ship?.key] || 0).toFixed(1) }) };
  return reason ? labels[reason] || t("不可操控") : t("就绪");
}

export function bunnyCastCost(ship) {
  const form = ship?.bunnyHaruhi?.nextForm;
  return t(form === "bless" ? "支付{cost}%最大生命 · 补能至{energy}%" : form === "encore" ? "回复{heal}%最大生命" : "补能至{energy}%", BUNNY_VIEW_PARAMS);
}

export function bunnyStatusLines(ship) {
  const lines = [];
  const view = ship?.bunnyHaruhi;
  if (view) {
    lines.push(t("原皮立绘占位"));
    if (ship.key === "main") lines.push(skillText(C.characterId, "flagship", "description"));
    else {
      lines.push(t("当前：{form}；下次：{next}", { form: bunnyFormLabel(view.form), next: bunnyFormLabel(view.nextForm) }));
      if (ship.alive) {
        lines.push(bunnyCastCost(ship));
        if (!view.enabled) lines.push(t("已封印"));
        if (view.positiveSuppressed) lines.push(t("强化已涤除"));
        if (view.lockedGear != null) lines.push(t("{gear}档锁定", { gear: view.lockedGear }));
        if (view.scoutsDisabled) lines.push(t("本舰侦察已停用"));
        if (view.enabled) {
          for (const [field, label] of [["immunityRemaining", "免伤 {seconds}s"], ["drainRemaining", "自损 {seconds}s"], ["broadcastRemaining", "广播 {seconds}s"]]) {
            if (view[field] > 0) lines.push(t(label, { seconds: view[field].toFixed(1) }));
          }
          if (view.broadcasting && view.form === "bless") lines.push(t("持续广播"));
        }
      }
      const companion = view.companion;
      lines.push(!view.companionSpawned ? t("阿虚：未召唤") : !companion?.alive ? t("阿虚：阵亡")
        : companion.convertedRemaining > 0 ? t("阿虚：策反 {seconds}s", { seconds: companion.convertedRemaining.toFixed(1) }) : t("阿虚：存活"));
      const names = { time_traveler: t("未来人"), otherworlder: t("异世界人"), esper: t("超能力者") };
      lines.push(view.supporters?.length ? t("支援：{names}", { names: view.supporters.map((id) => names[id]).filter(Boolean).join(" · ") }) : t("暂无支援"));
    }
  }
  const stage = ship?.bunnyStageExposure;
  if (ship?.alive && stage?.inside) {
    lines.push(t(stage.phase === "entranced" ? "入迷" : "哑口无言"));
    lines.push(t(stage.phase === "entranced" ? "战斗属性提高{stageBoost}%，每秒恢复{stageRegen}%最大生命。"
      : "沉默、航速与射速降低{speechlessSlow}%，停止自然回能。", BUNNY_VIEW_PARAMS));
    if (stage.phase === "speechless") lines.push(t("距入迷 {seconds}s", { seconds: stage.entranceRemaining.toFixed(1) }));
  }
  // 移动端隐藏状态图标时，关键形态代价与增益仍可通过点按舰况阅读。
  for (const effect of ship?.alive ? ship.statusEffects || [] : []) {
    if (["bunny_bless", "bunny_vulnerable", "bunny_knows", "bunny_reliable", "bunny_time_traveler", "bunny_otherworlder", "bunny_esper"].includes(effect.id)) {
      lines.push(t(STATUS_EFFECT_DEFS[effect.id].description, effect));
    }
    if (["bunny_lock", "bunny_recovery"].includes(effect.id)) {
      lines.push(`${t(STATUS_EFFECT_DEFS[effect.id].name)} · ${t("剩余{seconds}秒", { seconds: effect.remaining.toFixed(1) })}`);
    }
  }
  return lines;
}

// 各模式复用只读文字；不把敌方快照传入玩家自己的舰况区域。
export function renderBunnyReadout(container, ship) {
  if (!container) return;
  const text = bunnyStatusLines(ship).join(" · ");
  container.hidden = !text;
  if (container.textContent !== text) container.textContent = text;
  const details = container.closest(".bunny-details");
  if (details) {
    details.hidden = !text;
    const label = ship?.bunnyHaruhi ? ship.key === "main" ? t("舞台·被动") : bunnyFormLabel(ship.bunnyHaruhi.form)
      : t(ship?.bunnyStageExposure?.phase === "entranced" ? "入迷" : "哑口无言");
    details.querySelector("summary").textContent = `${t("兔女郎舰况")} · ${label}`;
  }
}
