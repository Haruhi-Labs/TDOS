import assert from "node:assert/strict";
import { distance, MatchSimulation } from "../shared/game-core.js";
import {
  getPveCampaign,
  PVE_CAMPAIGN_IDS,
  PVE_CAMPAIGN_MENU_ITEMS,
} from "../src/pve/campaigns.js";
import {
  createPveCampaignRuntime,
  pveSimulationOptions,
} from "../src/pve/campaign-runtime.js";

function createCampaign(campaignId, difficulty = "normal") {
  const options = pveSimulationOptions(campaignId, difficulty);
  const simulation = new MatchSimulation({ ...options, worldSize: 1440 });
  const runtime = createPveCampaignRuntime(simulation, campaignId, difficulty, { random: () => 0.5 });
  return { simulation, runtime };
}

function step(simulation, runtime, seconds) {
  const ticks = Math.ceil(seconds / 0.05);
  for (let index = 0; index < ticks && simulation.phase === "running"; index += 1) {
    runtime.updateBeforeStep(0.05);
    simulation.update(0.05);
    runtime.updateAfterStep(0.05);
  }
}

assert.equal(PVE_CAMPAIGN_MENU_ITEMS.length, 2, "战役菜单没有完整注册两张 PVE 地图");
for (const id of Object.values(PVE_CAMPAIGN_IDS)) {
  const campaign = getPveCampaign(id);
  assert(campaign, `无法读取战役 ${id}`);
  assert.equal(campaign.opening.length >= 5, true, `${campaign.title} 缺少完整开局台本`);
  assert.equal(new Set(Object.values(campaign.playerLoadout)).size, 3, `${campaign.title} 玩家固定编制出现重复角色`);
  assert.equal(new Set(Object.values(campaign.enemyLoadout)).size, 3, `${campaign.title} 敌方固定编制出现重复角色`);
}

{
  const { simulation, runtime } = createCampaign(PVE_CAMPAIGN_IDS.RESEARCH_CHALLENGE);
  assert.equal(simulation.teamB.forceFullVision, true, "电研社敌军没有启用真实全图视野");
  assert.equal(simulation.teamA.extraShips.length, 1, "强化长门援军没有创建");
  const ally = simulation.teamA.extraShips[0];
  assert.equal(ally.characterId, "yuki", "战役援军不是长门有希");
  assert.equal(ally.canControl(), false, "AI 援军被错误暴露给玩家控制");
  runtime.startBattle();
  simulation.setCombatEnabled("A", false);
  simulation.setCombatEnabled("B", false);
  simulation.setAiEnabled("B", false);
  step(simulation, runtime, 0.1);
  for (const ship of simulation.teamA.getAllShips()) {
    if (ship.alive) assert(simulation.teamB.visibleEnemyIds.has(ship.id), "作弊敌军没有把已存活目标纳入真实开火视野");
  }
  step(simulation, runtime, 8);
  assert(runtime.pendingTeleports.length > 0, "电研社敌军没有按时给出相位跃迁预警");
  const teleportingShip = runtime.pendingTeleports[0].ship;
  const beforeTeleport = { x: teleportingShip.x, y: teleportingShip.y };
  step(simulation, runtime, 1.5);
  assert(
    distance(beforeTeleport.x, beforeTeleport.y, teleportingShip.x, teleportingShip.y) > 100,
    "电研社敌军没有在预警后执行相位跃迁",
  );
  for (const ship of simulation.teamA.getPlayerShips()) ship.alive = false;
  ally.alive = true;
  simulation.checkVictory();
  assert.equal(simulation.winnerSeat, "B", "玩家三舰全灭后，非胜负单位的援军错误拖延了结算");
}

{
  const { simulation, runtime } = createCampaign(PVE_CAMPAIGN_IDS.JUSTICE_PREVAILS);
  runtime.startBattle();
  simulation.setCombatEnabled("A", false);
  simulation.setCombatEnabled("B", false);
  simulation.setAiEnabled("B", false);
  assert.equal(simulation.teamA.forceFullVision, true, "速攻战役开局没有全图观测优势");
  assert(simulation.teamA.scenarioModifiers.damage > 1, "速攻战役开局没有火控增幅");
  step(simulation, runtime, 31);
  assert.equal(runtime.phaseIndex, 1, "长门没有按时剥离第一阶段权限");
  assert.equal(simulation.teamA.scenarioModifiers.damage, 1, "第一阶段后火力增幅仍在生效");
  step(simulation, runtime, 19);
  assert.equal(runtime.phaseIndex, 2, "长门没有按时剥离第二阶段权限");
  assert.equal(simulation.teamA.forceFullVision, false, "第二阶段后玩家仍持有全图视野");
  step(simulation, runtime, 16);
  assert.equal(runtime.phaseIndex, 3, "长门没有完成最终解析");
  assert.equal(simulation.teamA.scenarioModifiers.speed, 1, "最终阶段后玩家动力作弊仍在生效");
  assert(simulation.teamB.ships.main.scenarioModifiers.damage >= 1.26, "最终阶段没有解放强化长门的完整战斗力");
}

{
  const normal = new MatchSimulation({ mode: "ai", worldSize: 1440 });
  assert.equal(normal.teamA.forceFullVision, false, "PVE 扩展污染了标准对战视野规则");
  assert.equal(normal.teamB.forceFullVision, false, "PVE 扩展污染了标准 AI 视野规则");
  assert.equal(normal.teamA.extraShips.length, 0, "标准对战被注入了战役附加舰船");
  assert.equal(normal.teamA.scenarioModifiers.damage, 1, "PVE 数值修正污染了标准对战面板");
}

console.log("PVE 战役规则校验通过：固定编制、剧情、作弊视野、相位跃迁、援军与分阶段权限均正常。");
