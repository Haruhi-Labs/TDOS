import { isMatchAction } from "../../shared/protocol/match-actions.js";

export function createLocalBattleActionTransport({
  getSimulation,
  seat = "A",
  canSend = () => true,
  onAccepted = () => {},
} = {}) {
  return {
    send(action) {
      const simulation = getSimulation ? getSimulation() : null;
      if (!simulation || !canSend(action) || !isMatchAction(action)) {
        return false;
      }
      const accepted = simulation.applyActionForSeat(seat, action);
      if (accepted) {
        onAccepted(action);
      }
      return accepted;
    },
  };
}

export function createRemoteBattleActionTransport({
  canSend,
  nextSequence,
  sendEnvelope,
  now = Date.now,
} = {}) {
  return {
    send(action) {
      if (!isMatchAction(action) || !canSend || !canSend(action)) {
        return null;
      }
      const seq = nextSequence();
      sendEnvelope({
        type: "input",
        seq,
        action,
        clientTime: now(),
      });
      return seq;
    },
  };
}
