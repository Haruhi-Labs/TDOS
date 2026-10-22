import { createTeamFutureForm } from "./form-port.js";
import { futureFormDefinition } from "./flagship-form.js";
export default {
  statusEffects: [
    [140, (ship, { add }) => {
    const team = ship.team;
    if (team.mainCharacterId() === "future1096" && team.future1096Form) {
      add(team.future1096Form === "A" ? "form_a_boost" : "form_b_defense");
      add(team.future1096Form === "A" ? "form_a_vulnerable" : "form_b_slow");
    }
    }]
  ],
  activeSkills: {
    flagship: (port) => port.switchForm(),
    sub: (port, meta) => {
      const ok = port.castBeam();
      if (!ok) port.refundEnergy(meta.cost || 0);
      return ok;
    },
  },
  id: "future1096",
  createTeam(team) {
    const future = createTeamFutureForm(team);
    return { capabilities: { get form() { return future.current; }, formDefinition: (form = future.current) => futureFormDefinition(form), statMultiplier: (key) => future.statMultiplier(key), damageMultiplier: () => future.damageTakenMultiplier(), switchForm: () => future.switch() } };
  },
  projectTeam: (team) => ({ future1096Form: team.future1096Form }),
};
