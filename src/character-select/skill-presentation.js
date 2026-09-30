import { CHARACTER_DEFS, skillMetaForCharacter } from "../../shared/game/characters.js";
import { KOIZUMI_BARRIER_DISABLE_SECONDS, KOIZUMI_BARRIER_MAX_HITS } from "../../shared/game/koizumi-barrier.js";
import { HARUHI_BOOST_MULTIPLIER, HARUHI_DAMAGE_TAKEN_MULTIPLIER, HARUHI_ALIEN_INTERVAL, HARUHI_TIME_TRAVELER_INTERVAL, HARUHI_TIME_TRAVELER_BEAM_GAP, HARUHI_OTHERWORLDER_COOLDOWN, HARUHI_OTHERWORLDER_DAMAGE_RATIO } from "../../shared/game/haruhi-flagship.js";
import { HARUHI_HERO_POWER_DAMAGE_TAKEN_MULTIPLIER } from "../../shared/game/haruhi-hero-power.js";
import { YUKI_RADAR_ROTATION_SECONDS } from "../../shared/game/combat-rules.js";
import { BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR, BLADE_QUEEN_RANGE_MULTIPLIER } from "../../shared/game/collision-system.js";
import { SHAMISEN_HUNT_DAMAGE_MULTIPLIER } from "../../shared/game/shamisen-hunt.js";
import { skillText, t } from "../i18n.js";

const number = (value) => String(Math.round(Number(value) * 1000) / 1000);
const seconds = (value) => t("{value}秒", { value: number(value) });
const percent = (value) => `${number(value * 100)}%`;
const multiplier = (value) => `×${number(value)}`;

export function skillOverview(characterId, mode) {
  return skillText(characterId, mode, "overview");
}

// 文案层只读规则元数据与已公开常量；规则中的固定倍率由技能展示回归核对。
export function skillDetailRows(characterId, mode) {
  const meta = skillMetaForCharacter(characterId, mode);
  const rows = [];
  const row = (label, value) => rows.push({ label: t(label), value: String(value) });
  row("技能性质", t(meta.type === "passive" ? "被动 · 自动生效" : "主动"));
  if (meta.type === "active") {
    row("技能冷却", seconds(meta.cooldown || 0));
    row("能量消耗", t("{energy}能量", { energy: meta.cost || 0 }));
    if (meta.duration) row("持续时间", seconds(meta.duration));
    if (mode === "sub") row("释放前提", t("副舰分离后可用"));
    if (meta.target === "point") row("释放方式", t("点击战场指定方向"));
    if (meta.target === "zone") row("释放方式", t("选择目标战区"));
  }
  switch (meta.id) {
    case "im_here":
      row("强化对象", t("全舰队"));
      for (const label of ["航速提升", "转向提升", "加速提升", "射程提升", "视野提升", "伤害提升", "射速提升"]) row(label, percent(HARUHI_BOOST_MULTIPLIER - 1));
      row("伤害减免", percent(1 - HARUHI_DAMAGE_TAKEN_MULTIPLIER));
      row("位置暴露", seconds(meta.duration));
      row("暴露方式", t("敌方持续获得全舰队真实视野"));
      row("常驻支援", t("每次随机解锁1种，最多4种"));
      row("宇宙人支援", t("每{seconds}秒释放1架战斗僚机", { seconds: HARUHI_ALIEN_INTERVAL }));
      row("未来人支援", t("每{seconds}秒释放3道随机光线", { seconds: HARUHI_TIME_TRAVELER_INTERVAL }));
      row("光线间隔", seconds(HARUHI_TIME_TRAVELER_BEAM_GAP));
      row("异世界人冲撞", t("目标最大舰体的{value}", { value: percent(HARUHI_OTHERWORLDER_DAMAGE_RATIO) }));
      row("冲撞间隔", seconds(HARUHI_OTHERWORLDER_COOLDOWN));
      row("冲撞前提", t("至少2档，舰首接触敌舰"));
      row("超能力者支援", t("环绕主舰并吸收敌弹"));
      break;
    case "hero_power":
      row("蓄力时间", seconds(meta.chargeDuration));
      row("冲击半径", t("战区宽度的{value}", { value: percent(meta.radiusZoneRatio) }));
      row("失速与禁控", seconds(meta.lockDuration));
      row("航速恢复", seconds(meta.recoveryDuration));
      row("易伤持续", seconds(meta.lockDuration + meta.recoveryDuration));
      row("承伤增加", percent(HARUHI_HERO_POWER_DAMAGE_TAKEN_MULTIPLIER - 1));
      row("清除飞行单位", t("范围内全部敌我侦察机与僚机"));
      break;
    case "closed_space_barrier":
      row("拦截次数", t("{value}次", { value: KOIZUMI_BARRIER_MAX_HITS }));
      row("护盾边界", t("主舰当前视野边界"));
      row("拦截对象", t("从圈外进入的敌弹与光束"));
      row("每次消耗", t("每颗子弹或每次光束消耗1次"));
      row("最后一次拦截", t("仍然生效，随后破盾"));
      row("修复等待", seconds(KOIZUMI_BARRIER_DISABLE_SECONDS));
      row("修复条件", t("连续没有敌方子弹穿越原边界；己方子弹不影响"));
      row("修复后次数", t("{value}次", { value: KOIZUMI_BARRIER_MAX_HITS }));
      row("直接破盾", t("刀锋女王、超能力粒子、异世界人冲撞"));
      break;
    case "esper":
      row("碰撞伤害", "0");
      row("碰撞沉默", seconds(meta.silenceDuration));
      row("能量波眩晕", seconds(meta.stunDuration));
      row("光球状态", t("无法射击，免疫伤害"));
      row("结束行为", t("保持光球形态，自动返回战场中央"));
      break;
    case "data_overmind_radar":
      row("雷达范围", t("全战场"));
      row("扫描周期", seconds(YUKI_RADAR_ROTATION_SECONDS));
      row("识别距离", t("1个战区宽度以内"));
      row("雷达精度", t("距离越近，位置误差越小"));
      row("真实视野", t("雷达不提供真实视野"));
      row("派出单位", t("每次1架战斗僚机"));
      row("僚机视野", number(CHARACTER_DEFS.yuki.stats.vision));
      row("僚机射程", number(CHARACTER_DEFS.yuki.stats.vision));
      row("僚机伤害", "16");
      row("僚机射速", t("{value}发/秒", { value: number(CHARACTER_DEFS.yuki.stats.fireRate) }));
      break;
    case "apm_overdrive":
      row("释放方向", t("{value}个方向", { value: 8 }));
      row("每方向数量", t("{value}架", { value: 2 }));
      row("侦察机总数", t("{value}架", { value: 16 }));
      row("侦察机航速", "118");
      row("侦察机视野", "82");
      row("侦察机寿命", seconds(10.5));
      break;
    case "past_future_me":
      row("作用对象", t("全舰队"));
      row("初始形态", t("无形态"));
      row("切换顺序", t("首次A，此后A与B交替"));
      row("A形态射速", multiplier(2));
      row("A形态航速", multiplier(1.5));
      row("A形态承伤", multiplier(2));
      row("B形态射速", multiplier(0.5));
      row("B形态航速", multiplier(0.5));
      row("B形态承伤", multiplier(0.5));
      row("形态持续", t("直到下一次切换"));
      break;
    case "beam_1096":
      row("蓄力时间", seconds(1.05));
      row("光线射程", "1460");
      row("命中1艘", t("每艘最大舰体的{value}", { value: "28%" }));
      row("命中2艘", t("每艘最大舰体的{value}", { value: "21%" }));
      row("命中3艘及以上", t("每艘最大舰体的{value}", { value: "18%" }));
      break;
    case "reality_seeker":
      row("作用对象", t("全舰队"));
      row("转向倍率", multiplier(1.28));
      row("加速倍率", multiplier(1.16));
      row("最小转弯半径", multiplier(0.62));
      row("全方向射速", multiplier(1.5));
      row("船尾开火", t("可以，火力与其他方向一致"));
      break;
    case "reliable_normal":
      row("转向倍率", multiplier(1.28));
      row("航速倍率", multiplier(1.08));
      row("伤害倍率", multiplier(1.08));
      row("加速倍率", multiplier(1.12));
      row("立即修复", t("自身最大舰体的{value}", { value: "18%" }));
      break;
    case "secret_sponsor":
      row("作用对象", t("全舰队"));
      row("冷却流逝速度", multiplier(2));
      row("每秒修复", t("每艘最大舰体的{value}", { value: "1%" }));
      break;
    case "money_power":
      row("生效范围", t("1个目标战区"));
      row("转化对象", t("战区内全部敌方侦察机与僚机"));
      row("持续时间", t("转化永久生效"));
      row("无可转化单位", t("返还能量，不进入冷却"));
      break;
    case "no_escape":
      row("视野波间隔", seconds(meta.pulseInterval));
      row("发射中心", t("主舰当前位置"));
      row("视野效果", t("波带覆盖区域的真实视野"));
      row("敌舰效果", t("涤除主动技能增益"));
      row("友舰效果", t("驱散负面状态"));
      row("敌方可见", t("视野波对双方可见"));
      break;
    case "blade_queen":
      row("航速倍率", multiplier(1.45));
      row("加速倍率", multiplier(1.26));
      row("转向倍率", multiplier(1.12));
      row("刀锋半径", multiplier(BLADE_QUEEN_RANGE_MULTIPLIER));
      row("二档及以下伤害", t("每秒目标最大舰体的{value}", { value: percent(BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[2]) }));
      row("三档伤害", t("每秒目标最大舰体的{value}", { value: percent(BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[3]) }));
      row("四档伤害", t("每秒目标最大舰体的{value}", { value: percent(BLADE_QUEEN_DAMAGE_RATIO_BY_GEAR[4]) }));
      row("伤害变化", t("档位之间按实际航速线性变化"));
      row("碰撞体积", t("忽略，可穿过敌舰"));
      break;
    case "hunt_decree":
      row("标记数量", t("1名敌舰"));
      row("舰炮伤害倍率", multiplier(SHAMISEN_HUNT_DAMAGE_MULTIPLIER));
      row("加成范围", t("子弹与其命中触发的攻击特效"));
      row("不受加成", t("技能、状态效果与碰撞伤害"));
      row("标记视野", t("双方可见，可追踪但不提供真实视野"));
      row("锁定优先级", t("目标进入真实视野后优先攻击"));
      row("目标击沉后", t("自动标记下一名敌舰"));
      break;
    case "cat_paw_barrage":
      row("射速提升", percent(meta.fireRateMultiplier - 1));
      row("引爆命中次数", t("同一敌舰{value}次", { value: meta.triggerHits }));
      row("额外爆发伤害", number(meta.burstDamage));
      row("抓痕保留", t("连续{seconds}秒未刷新后消退", { seconds: meta.markDuration }));
      break;
  }
  return rows;
}
