// 选择舰船与发送战斗指令分开：短时禁控仍保留选舰，动作权限继续读取权威 canControl。
export function isShipControlLocked(ship) {
  return Boolean(ship?.alive && (Number(ship.stunRemaining) > 0 || ship.heroPowerShock?.controlLocked || ship.bunnyStageExposure?.controlLocked));
}

export function isShipSelectable(ship) {
  return Boolean(ship?.alive && ship.entityRole !== "bunny_kyon" && !ship.attached && ship.koizumiOrb?.phase !== "returning"
    && (ship.canControl || isShipControlLocked(ship)));
}

export function resolveSelectedShipKey(team, selectedKey) {
  if (isShipSelectable(team?.ships?.[selectedKey])) return selectedKey;
  return Object.keys(team?.ships || {}).find((key) => isShipSelectable(team.ships[key])) || selectedKey;
}
