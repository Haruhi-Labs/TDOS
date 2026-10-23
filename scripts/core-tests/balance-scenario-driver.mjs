import { SkillDecisionCycle } from '../../shared/game/ai/policy/state/skill-decision-cycle.js';
import { aiActions, AI_ACTION_TYPES } from '../../shared/game/ai/actions.js';
import { clamp } from '../../shared/game/foundation/math.js';
import { BUNNY_HARUHI_CONFIG as C } from '../../shared/game/characters/bunny-haruhi/config.js';

// 离线条件策略独立拥有调度，通过观测/标准动作参与对局，不改写正式策略的方法或存储。
export function installBalanceScenario(sim, seat, scenario, variant) {
  const runner = sim.aiRunners[seat];
  const bot = runner.policy;
  let decisions = 0;
  if (scenario.policy && variant === 'new') {
    const cycle = new SkillDecisionCycle({ flagship: 0, sub1: bot.subTimers.sub1, sub2: 0, now: sim.elapsed });
    const advance = runner.update.bind(runner);
    runner.update = (dt, elapsed) => {
      bot.scheduleSkillDecision('sub1', 1e6);
      advance(dt, elapsed);
      cycle.advance(dt);
      const obs = runner.port.observe();
      const ship = obs.self.ships.sub1;
      const context = bot.currentContext;
      const estimate = context?.focus || null;
      cycle.trySub({ T: bot.params.skills.subTimers, now: obs.time, shipKey: 'sub1', ship, estimate, context, facts: null }, {
        shouldCast() {
          decisions++;
          // 施放次数是条件场景的只读控制量，不向正式 AI 开放实体通道。
          const state = sim.teamBySeat(seat).ships.sub1.bunnyHaruhi;
          if (scenario.policy === 'bless') return state.successfulCasts === 0;
          if (scenario.policy === 'encore') return state.successfulCasts < 4;
          if (scenario.policy === 'defense') return state.form === 'bless' ? ship.hp / ship.maxHp < 0.48 : bot.shouldCastSubSkill(ship, estimate, context);
          return true;
        },
        cast: () => runner.port.submit(aiActions.castSubSkill({ shipKey: 'sub1' })),
        cooldown: () => runner.port.observe().self.cooldowns.sub1,
        randomRange: (min, max) => sim.aiRng[seat].range(min, max),
        describeTarget: (target) => target,
      });
    };
  }
  if (scenario.route) {
    const enemy = sim.aiRunners[seat === 'A' ? 'B' : 'A'];
    const submit = enemy.port.submit.bind(enemy.port);
    enemy.port.submit = (action) => {
      const contact = enemy.policy.currentContext?.focus;
      if (action.type === AI_ACTION_TYPES.SET_ROUTE && contact && contact.source !== 'spawn'
        && (contact.visible || contact.age <= 3)) {
        const obs = enemy.port.observe();
        const ship = obs.self.ships[action.shipKey];
        const angle = Math.atan2(ship.y - contact.y, ship.x - contact.x) + (scenario.route === 'kite' ? 0.4 : 0);
        const radius = scenario.route === 'kite' ? C.baseStats.vision + 80 : C.baseStats.vision + (Math.floor(obs.time / 4) % 2 ? 60 : -50);
        const padding = enemy.policy.safeRoutePadding();
        action = { ...action, endX: clamp(contact.x + Math.cos(angle) * radius, padding, obs.world.size - padding),
          endY: clamp(contact.y + Math.sin(angle) * radius, padding, obs.world.size - padding) };
      }
      return submit(action);
    };
  }
  return Object.freeze({ get decisions() { return decisions; } });
}

// 观察领域操作的真实到账差额；不遮蔽 hp getter，也不引入第二份机体生命值。
export function observeHullTransactions(unit, consume) {
  let depth = 0;
  for (const name of ['grantResources', 'scaleHullCapacity', 'configureTraining', 'resetHullCapacity', 'retireWithoutLoss', 'restoreHull', 'drainHull', 'applyHullDamage']) {
    const operation = unit[name].bind(unit);
    unit[name] = (...args) => {
      const before = unit.hp;
      depth++;
      try { return operation(...args); }
      finally {
        depth--;
        if (!depth && unit.hp !== before) consume(unit.hp - before, new Error().stack);
      }
    };
  }
}
