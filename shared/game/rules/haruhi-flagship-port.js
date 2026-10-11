import { HaruhiFlagshipRuntime } from "../haruhi-flagship-runtime.js";
import { HARUHI_SUPPORTS, unlockSupport } from "../haruhi-support.js";
import { HARUHI_SUPPORT_ANNOUNCEMENT_KEYS } from "../model/model-support.js";
import { rngFor } from "../rng.js";

export function createTeamHaruhiFlagship(team) {
  return new HaruhiFlagshipRuntime({
    enabled: () => team.mainCharacterId() === "haruhi",
    now: () => team.match.elapsed,
    tick: () => team.match.tick,
    random: () => rngFor(team.match).next(),
    unlockSupport: (now, random) => unlockSupport(team.haruhiFlagship, HARUHI_SUPPORTS, now, random),
    boostTempo: (multiplier) => {
      for (const ship of team.getPlayerShips()) {
        if (ship.alive) ship.boostCombatTempo(multiplier);
      }
    },
    announce: (supporter) => {
      const main = team.ships.main;
      team.match.spawnAnnouncementKey(main.x, main.y - main.radius - 18, "我在这里！", {}, "#ffe59a");
      team.match.spawnBurst(main.x, main.y, "#ffe59a", Math.max(16, main.radius * 1.7));
      if (supporter) team.match.spawnAnnouncementKey(main.x, main.y + main.radius + 42,
        HARUHI_SUPPORT_ANNOUNCEMENT_KEYS[supporter], {}, "#fff3c5");
    },
  });
}
