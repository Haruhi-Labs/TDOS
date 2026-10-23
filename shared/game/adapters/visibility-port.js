import { visionWavesCoverEntity } from "../characters/asakura/vision-wave.js";

export function visibilityInputs(team, enemyTeam) {
  return {
    sensors: team.getVisionSources(),
    entities: enemyTeam.getEntities(),
    coveredByWave: (entity) => visionWavesCoverEntity(team, entity),
    broadcast: team.match.rules.broadcastShips(enemyTeam),
  };
}
