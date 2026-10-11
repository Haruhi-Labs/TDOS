// 主动技能声明只消费受限操作端口；公共校验、资源池与冷却由舰队掌管。
const FLAGSHIP_EFFECTS = Object.freeze({
  haruhi: (port, meta) => {
    if (!port.spendEnergy(meta.cost || 0)) return false;
    port.activateSupport(meta.duration || 16);
    return true;
  },
  future1096: (port) => port.switchForm(),
  tsuruya: (port, meta) => {
    if (!port.spendEnergy(meta.cost || 0)) return false;
    port.activateSponsor(meta.duration || 8);
    return true;
  },
  asakura: (port, meta) => {
    if (!port.spendEnergy(meta.cost || 0)) return false;
    port.activateVisionWave({ duration: meta.duration || 6, interval: meta.pulseInterval || 1 });
    return true;
  },
});

const SUB_EFFECTS = Object.freeze({
  haruhi: (port, meta) => { port.emitHeroPower(meta); return true; },
  koizumi: (port, meta) => port.activateOrb(meta.duration || 8),
  yuki: (port) => { port.launchBurstScouts(); return true; },
  future1096: (port, meta) => {
    const ok = port.castBeam();
    if (!ok) port.refundEnergy(meta.cost || 0);
    return ok;
  },
  kyon: (port, meta) => {
    port.activateEffect("reliableUntil", meta.duration || 14);
    port.restoreHullFraction(0.18);
    return true;
  },
  tsuruya: (port, meta) => {
    const ok = port.bribeZone();
    if (!ok) port.refundEnergy(meta.cost || 0);
    return ok;
  },
  asakura: (port, meta) => {
    port.activateEffect("bladeQueenUntil", meta.duration || 10);
    port.ensureMinimumSpeed();
    return true;
  },
  shamisen: (port, meta) => { port.activateEffect("catPawUntil", meta.duration || 12); return true; },
});

export function executeFlagshipEffect(characterId, port, meta) {
  return Object.hasOwn(FLAGSHIP_EFFECTS, characterId) ? FLAGSHIP_EFFECTS[characterId](port, meta) : false;
}

export function executeSubEffect(characterId, port, meta) {
  return Object.hasOwn(SUB_EFFECTS, characterId) ? SUB_EFFECTS[characterId](port, meta) : false;
}
