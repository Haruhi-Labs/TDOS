import { createTeamSponsor } from "../sponsor-port.js";
export default {
  activeSkills: {
    flagship: (port, meta) => {
      if (!port.spendEnergy(meta.cost || 0)) return false;
      port.activateSponsor(meta.duration || 8);
      return true;
    },
    sub: (port, meta) => {
      const ok = port.bribeZone();
      if (!ok) port.refundEnergy(meta.cost || 0);
      return ok;
    },
  },
  id: "tsuruya",
  createTeam(team) {
    const sponsor = createTeamSponsor(team);
    return {
      capabilities: { sponsorActive: () => sponsor.active(), activateSponsor: (duration) => sponsor.activate(duration), cooldownStep: (dt) => sponsor.cooldownStep(dt), regenerate: (dt) => sponsor.regenerate(dt) },
      effects: () => ({ sponsorUntil: sponsor.expiresAt }),
      hooks: { clearPositive: [[10, (preserveCurrentTick) => sponsor.clear({ preserveCurrentTick })]] },
    };
  },
};
