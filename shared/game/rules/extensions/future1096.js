import { createTeamFutureForm } from "../future-form-port.js";
import { futureFormDefinition } from "../../future-flagship-form.js";
export default {
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
