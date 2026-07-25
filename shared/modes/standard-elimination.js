import { MODE_STATUS, createEmptyOutcome } from "./mode-definition.js";

function allianceAlive(snapshot, allianceId) {
  const fleets = snapshot?.fleets || {};
  const seats = snapshot?.alliances?.[allianceId]?.fleetSeats || (allianceId === "A" ? ["A"] : ["B"]);
  return seats.some((seat) => {
    const fleet = fleets[seat] || (seat === "A" ? snapshot?.teams?.A : seat === "B" ? snapshot?.teams?.B : null);
    if (!fleet?.ships) return false;
    return Object.values(fleet.ships).some((ship) => ship && ship.alive);
  });
}

export const standardEliminationMode = {
  id: "standard-elimination",
  name: "标准歼灭",
  description: "摧毁敌方全部舰队。兼容当前 MatchSimulation 胜负。",
  status: MODE_STATUS.EXPERIMENTAL,
  version: 1,
  parameterSchema: [],
  defaultParameters: {},

  createInitialModeState() {
    return {};
  },

  updateModeState({ modeState }) {
    return modeState || {};
  },

  resolveOutcome({ simulation, snapshot }) {
    const empty = createEmptyOutcome();
    const phase = snapshot?.phase || simulation?.phase;
    if (phase !== "finished") {
      // 兼容尚未写入 phase 的情况：直接看存活
      const aAlive = allianceAlive(snapshot, "A");
      const bAlive = allianceAlive(snapshot, "B");
      if (aAlive && bAlive) return empty;
      if (!aAlive && !bAlive) {
        return { finished: true, winnerAllianceId: null, winnerSeat: null, reason: "mutual_destruction", label: "双方同归于尽" };
      }
      if (aAlive) {
        return { finished: true, winnerAllianceId: "A", winnerSeat: snapshot?.winnerSeat || "A", reason: "elimination", label: "A 阵营歼灭敌方" };
      }
      return { finished: true, winnerAllianceId: "B", winnerSeat: snapshot?.winnerSeat || "B", reason: "elimination", label: "B 阵营歼灭敌方" };
    }

    const winnerAllianceId =
      snapshot?.winnerAllianceId ||
      simulation?.winnerAllianceId ||
      (snapshot?.winnerSeat === "A" || snapshot?.winnerSeat === "B" ? snapshot.winnerSeat : null);

    if (!winnerAllianceId && !snapshot?.winnerSeat) {
      return { finished: true, winnerAllianceId: null, winnerSeat: null, reason: "draw", label: "平局" };
    }

    return {
      finished: true,
      winnerAllianceId: winnerAllianceId || null,
      winnerSeat: snapshot?.winnerSeat || simulation?.winnerSeat || null,
      reason: "elimination",
      label: winnerAllianceId ? `${winnerAllianceId} 阵营获胜` : "战斗结束",
    };
  },

  buildDiagnostics() {
    return {};
  },

  serializeModeState(modeState) {
    return modeState || {};
  },
};
