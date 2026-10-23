import { normalizeDamageContext } from "../rules/damage.js";

// 承伤事务保持增幅、递归分摊、自身扣血、死亡收尾的同步顺序。
// 目标句柄只允许投递份额，不能改写其他舰船的资源。
export function resolveHullDamage(port, amount, context) {
  if (!port.canDamage()) return false;
  if (!port.alive() || port.immune()) return;
  const { share, kind } = normalizeDamageContext(context);
  if (share) amount *= port.attackMultiplier(kind);
  if (share) {
    const others = port.shareTargets();
    if (others.length > 0) {
      const shared = amount * port.shareRatio;
      amount -= shared;
      const per = shared / others.length;
      for (const target of others) target.hit(per, { share: false, kind });
    }
  }
  const loss = port.applyDamage(amount * port.damageMultiplier());
  port.recordDamage(loss, kind);
  if (port.hp() > 0) return;
  port.retire();
  port.resolveFormation();
  port.finishDeath();
}
