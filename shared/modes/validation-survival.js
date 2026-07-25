import { MODE_STATUS, createEmptyOutcome } from "./mode-definition.js";

function teamAAlive(snapshot) {
  const fleet = snapshot?.fleets?.A || snapshot?.teams?.A;
  if (!fleet?.ships) return false;
  return Object.values(fleet.ships).some((ship) => ship && ship.alive);
}

export const validationSurvivalMode = {
  id: "validation-survival",
  name: "限时生存验证",
  description: "A 队坚持指定秒数则获胜；A 提前全灭则 B 获胜。用于验证平台可扩展性。",
  status: MODE_STATUS.EXPERIMENTAL,
  version: 1,
  parameterSchema: [
    {
      key: "survivalSeconds",
      label: "生存时间（秒）",
      description: "A 队需要存活的目标时长",
      type: "number",
      min: 10,
      max: 300,
      step: 10,
      default: 60,
    },
  ],
  defaultParameters: {
    survivalSeconds: 60,
  },

  createInitialModeState() {
    return {
      survivedSeconds: 0,
      aEliminated: false,
    };
  },

  updateModeState({ modeState, snapshot, parameters, dt }) {
    const next = { ...(modeState || this.createInitialModeState()) };
    const alive = teamAAlive(snapshot);
    if (!alive) {
      next.aEliminated = true;
      return next;
    }
    next.aEliminated = false;
    next.survivedSeconds = Number(next.survivedSeconds || 0) + Number(dt || 0);
    const limit = Number(parameters?.survivalSeconds) || 60;
    next.survivedSeconds = Math.min(next.survivedSeconds, limit);
    return next;
  },

  resolveOutcome({ modeState, parameters, snapshot }) {
    const empty = createEmptyOutcome();
    const limit = Number(parameters?.survivalSeconds) || 60;
    const survived = Number(modeState?.survivedSeconds) || 0;
    const alive = teamAAlive(snapshot);

    if (!alive || modeState?.aEliminated) {
      return {
        finished: true,
        winnerAllianceId: "B",
        winnerSeat: "B",
        reason: "a_eliminated",
        label: "A 队被歼灭，B 获胜",
      };
    }

    if (survived + 1e-6 >= limit) {
      return {
        finished: true,
        winnerAllianceId: "A",
        winnerSeat: "A",
        reason: "survived",
        label: `A 队存活满 ${limit} 秒`,
      };
    }

    return empty;
  },

  buildDiagnostics({ modeState, parameters }) {
    const limit = Number(parameters?.survivalSeconds) || 60;
    const survived = Number(modeState?.survivedSeconds) || 0;
    return {
      生存目标秒: limit,
      已存活秒: Number(survived.toFixed(1)),
      剩余秒: Number(Math.max(0, limit - survived).toFixed(1)),
    };
  },

  serializeModeState(modeState) {
    return {
      survivedSeconds: Number(modeState?.survivedSeconds) || 0,
      aEliminated: Boolean(modeState?.aEliminated),
    };
  },
};
