// 战斗状态与结算读模型统一输出边界：在模式装配期选定输出契约，隔离旧模式与多舰队模式投影。
import { cloneLoadout } from "../characters/catalog.js";
import { freezePlainData } from "../../data/plain-data.js";
import {
  LEGACY_STATE_SCHEMA,
  MULTI_FLEET_STATE_SCHEMA,
  participantOutcomeForSeat,
} from "../rules/side-outcome.js";
import { MULTI_FLEET_TEAM_WIRE_FIELDS, orderedProjection } from "./projection-order.js";

function summarizeTeamBase(team) {
  return {
    seat: team.seat,
    loadout: cloneLoadout(team.loadout),
    splitLevel: team.splitLevel,
    hullRatio: Math.round(team.hullRatio() * 10000) / 10000,
    ships: Object.fromEntries(["main", "sub1", "sub2"].map((key) => {
      const ship = team.ships[key];
      return [key, {
        alive: Boolean(ship.alive),
        hp: Math.round(Math.max(0, ship.hp) * 100) / 100,
        maxHp: Math.round(Math.max(0, ship.maxHp) * 100) / 100,
        energy: Math.round(Math.max(0, ship.energy) * 100) / 100,
        maxEnergy: Math.round(Math.max(0, ship.maxEnergy) * 100) / 100,
      }];
    })),
    survivingScouts: team.scouts.filter((item) => item.alive).length,
    survivingWingmen: team.wingmen.filter((item) => item.alive).length,
  };
}

function projectMultiFleetTeam(team) {
  const serialized = team.serialize();
  return orderedProjection(serialized, { sideId: team.sideId }, MULTI_FLEET_TEAM_WIRE_FIELDS);
}

function cloneOutcome(outcome) {
  if (!outcome) return null;
  return {
    type: outcome.type,
    winnerSideId: outcome.winnerSideId,
    winnerSeats: [...outcome.winnerSeats],
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
}

const legacyProjector = Object.freeze({
  schema: LEGACY_STATE_SCHEMA,
  serializeState(source) {
    return {
      world: {
        size: source.worldSize,
      },
      mode: source.mode,
      aiSeats: [...source.aiSeats],
      zones: source.zones.map((zone) => ({ ...zone })),
      phase: source.phase,
      winnerSeat: source.winnerSeat,
      ...(source.endReason ? { endReason: source.endReason } : {}),
      elapsed: source.elapsed,
      projectiles: source.projectiles.map((projectile) => projectile.serialize()),
      bursts: source.bursts.map((burst) => burst.serialize()),
      haruhiHeroPowerEffects: source.projectHeroPowers(),
      shamisenHuntKillEffects: source.serializeHuntKills(),
      koizumiBarrierImpacts: source.serializeBarrierImpacts(),
      floatingTexts: source.floatingTexts.map((label) => label.serialize()),
      teams: {
        A: source.teamA.serialize(),
        B: source.teamB.serialize(),
      },
      bots: {
        A: source.botBySeat("A") ? source.botBySeat("A").serializeDebugState() : null,
        B: source.botBySeat("B") ? source.botBySeat("B").serializeDebugState() : null,
      },
    };
  },
  statisticsSummary(source) {
    return {
      tick: source.tick,
      durationSeconds: Math.round(source.elapsed * 1000) / 1000,
      winnerSeat: source.winnerSeat,
      ...(source.battleMode !== "standard" ? { battleMode: source.battleMode } : {}),
      worldSize: source.worldSize,
      teams: {
        A: summarizeTeamBase(source.teamA),
        B: summarizeTeamBase(source.teamB),
      },
      telemetry: source.serializeTelemetry(),
    };
  },
});

const multiFleetProjector = Object.freeze({
  schema: MULTI_FLEET_STATE_SCHEMA,
  serializeState(source) {
    const teams = Object.fromEntries(
      source.allTeams().map((team) => [team.seat, projectMultiFleetTeam(team)]),
    );
    const bots = Object.fromEntries(
      source.seatOrder.map((seat) => {
        const bot = source.botBySeat(seat);
        return [seat, bot ? bot.serializeDebugState() : null];
      }),
    );
    return freezePlainData({
      schema: MULTI_FLEET_STATE_SCHEMA,
      battleMode: source.battleMode,
      formatId: source.formatId,
      world: {
        size: source.worldSize,
      },
      mode: source.mode,
      seatOrder: [...source.seatOrder],
      aiSeats: [...source.aiSeats],
      zones: source.zones.map((zone) => ({ ...zone })),
      phase: source.phase,
      outcome: cloneOutcome(source.outcome),
      ...(source.endReason ? { endReason: source.endReason } : {}),
      elapsed: source.elapsed,
      projectiles: source.projectiles.map((projectile) => projectile.serialize()),
      bursts: source.bursts.map((burst) => burst.serialize()),
      haruhiHeroPowerEffects: source.projectHeroPowers(),
      shamisenHuntKillEffects: source.serializeHuntKills(),
      koizumiBarrierImpacts: source.serializeBarrierImpacts(),
      floatingTexts: source.floatingTexts.map((label) => label.serialize()),
      teams,
      bots,
    });
  },
  statisticsSummary(source) {
    const outcome = cloneOutcome(source.outcome);
    const teams = Object.fromEntries(
      source.allTeams().map((team) => {
        const base = summarizeTeamBase(team);
        return [team.seat, {
          seat: base.seat,
          sideId: team.sideId,
          outcome: participantOutcomeForSeat(outcome, team.seat, team.sideId),
          loadout: base.loadout,
          splitLevel: base.splitLevel,
          hullRatio: base.hullRatio,
          ships: base.ships,
          survivingScouts: base.survivingScouts,
          survivingWingmen: base.survivingWingmen,
        }];
      }),
    );
    return freezePlainData({
      schema: MULTI_FLEET_STATE_SCHEMA,
      formatId: source.formatId,
      battleMode: source.battleMode,
      seatOrder: [...source.seatOrder],
      tick: source.tick,
      durationSeconds: Math.round(source.elapsed * 1000) / 1000,
      outcome,
      ...(source.endReason ? { endReason: source.endReason } : {}),
      worldSize: source.worldSize,
      teams,
      telemetry: source.serializeTelemetry(),
    });
  },
});

export function createBattleStateProjector(stateSchema = LEGACY_STATE_SCHEMA) {
  if (stateSchema === LEGACY_STATE_SCHEMA) return legacyProjector;
  if (stateSchema === MULTI_FLEET_STATE_SCHEMA) return multiFleetProjector;
  throw new Error(`未知战斗状态输出契约：${String(stateSchema)}`);
}
