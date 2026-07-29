import { stellarTerritoryMode } from "../../../shared/modes/stellar-territory.js";
import { DEFAULT_TEAM_LOADOUT, DEFAULT_AI_LOADOUT, cloneLoadout } from "../../../shared/game-core.js";
import { createStellarTerritoryPresentation } from "../../modes/stellar-territory/presentation.js";

const STELLAR_TERRITORY_3V3_LAYOUT = Object.freeze({
  alliances: {
    A: Object.freeze([
      Object.freeze({ seat: "A1", control: "human", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) }),
      Object.freeze({ seat: "A2", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) }),
      Object.freeze({ seat: "A3", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) }),
    ]),
    B: Object.freeze([
      Object.freeze({ seat: "B1", control: "ai", loadout: cloneLoadout(DEFAULT_AI_LOADOUT) }),
      Object.freeze({ seat: "B2", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) }),
      Object.freeze({ seat: "B3", control: "ai", loadout: cloneLoadout(DEFAULT_TEAM_LOADOUT) }),
    ]),
  },
  localSeat: "A1",
});

export const stellarTerritoryPreset = {
  ...stellarTerritoryMode,
  name: "星域争夺战",
  description: "资源、控制区、战术技能与复活驱动的新玩法骨架。",
  runtimePreset: {
    worldSize: 3200,
    persistentMinimap: true,
    controlA: "human",
    controlB: "ai",
    teamNameA: "星域 A 阵营",
    teamNameB: "星域 B 阵营",
    defaultLoadoutA: DEFAULT_TEAM_LOADOUT,
    defaultLoadoutB: DEFAULT_AI_LOADOUT,
    aiDifficulty: "normal",
    initialCameraZoom: 1.8,
    cameraZoom: Object.freeze({ min: 0.45, max: 2.6, step: 0.1 }),
    cameraPanEnabled: true,
    showLegacyZones: false,
    victoryPolicy: "external",
    aiNavigationOwner: "mode",
    fleetLayout: STELLAR_TERRITORY_3V3_LAYOUT,
    presentationFactory: createStellarTerritoryPresentation,
  },
};
