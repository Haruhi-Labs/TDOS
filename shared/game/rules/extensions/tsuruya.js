import { createTeamSponsor } from "../sponsor-port.js";
export default {
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
