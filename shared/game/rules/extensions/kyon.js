export default {
  rules: {
    turnRateMultiplier(team, formation = false) {
      return team.hasKyonFlagship() ? (formation ? 1.2 : 1.28) : 1;
    },
    accelerationMultiplier(team) {
      return team.hasKyonFlagship() ? 1.16 : 1;
    },
    routeTurnRadiusMultiplier(team) {
      return team.hasKyonFlagship() ? 0.62 : 1;
    },
    routeDeviationMultiplier(team) {
      return team.hasKyonFlagship() ? 1.4 : 1;
    },
    improvedFireArcs(team) {
      return team.hasKyonFlagship();
    },
  },
  id: "kyon",
};
