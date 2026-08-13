// 更新日志内容与展示层分离：新增版本时按相同 id 同步补齐 zh / ja / en，页面无需改动。

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const CHANGELOG_BY_LOCALE = deepFreeze({
  zh: [
    {
      id: "v0.3",
      version: "v0.3",
      date: "2026-08-13",
      title: "公测版 v0.3",
      groups: [
        {
          id: "characters",
          title: "角色与技能",
          items: [
            {
              id: "haruhi-flagship",
              title: "重做「凉宫春日」主舰技能",
              body: "“我在这里！”开启后会向所有敌人昭示己方舰队位置，给予己方舰队整体数值提升，并从宇宙人、未来人、异世界人、超能力者中随机找到一位，为全舰队提供常驻的正面增强。",
            },
            {
              id: "koizumi-sub",
              title: "重做「古泉一树」分舰技能",
              body: "“超能力粒子”开启后使古泉化作速度和机动大幅增强的光球，无法射击且不会受到伤害；碰撞敌舰可将其击退并沉默5秒。技能结束后，古泉会以光球形态回归战场中央。",
            },
            {
              id: "koizumi-flagship",
              title: "重做「古泉一树」主舰技能",
              body: "“超能力屏障”会被动在自身视野边界创造屏障，拦截从屏障外射来的子弹或光线，但会被舰体冲击类技能打破。",
            },
            {
              id: "shamisen-flagship",
              title: "新增「三味线」主舰技能",
              body: "“猫爪印记”会在开局时随机标记一名敌人，己方舰队对其造成的子弹伤害翻倍；击破标记目标后，标记会转移至另一名随机敌方角色。",
            },
            {
              id: "haruhi-sub",
              title: "重做「凉宫春日」分舰技能",
              body: "“勇者之力”会在短暂蓄力后向附近释放冲击，对被波及的敌人先后造成眩晕与减速，并在整个负面效果持续期间施加易伤。",
            },
          ],
        },
        {
          id: "balance",
          title: "平衡性与 AI",
          items: [
            {
              id: "yuki-flagship",
              title: "加强「长门有希」主舰技能",
              body: "主舰每次释放的战斗僚机增加至两艘，并大幅提高“资讯统合雷达”的扫描速度。",
            },
            {
              id: "future1096-sub",
              title: "调整「朝比奈实玖瑠」分舰技能",
              body: "适当下调“1096光线”同时命中多个敌人时造成的伤害。",
            },
            {
              id: "asakura-sub",
              title: "加强「朝仓凉子」分舰技能",
              body: "适当提高“刀锋女王”的伤害与作用范围。",
            },
            {
              id: "character-ai",
              title: "优化角色 AI",
              body: "优化了 AI 对部分角色的操控和针对性应对策略。",
            },
          ],
        },
        {
          id: "systems",
          title: "系统与性能",
          items: [
            {
              id: "winrate-statistics",
              title: "接入阵容胜率统计系统",
              body: "新增单人游戏与多人游戏的阵容出场场次、胜率统计及榜单展示。",
            },
            {
              id: "webgl2",
              title: "首选 WebGL2 渲染路径",
              body: "将战场的首选渲染路径切换至 WebGL2，以提升渲染性能。",
            },
          ],
        },
      ],
    },
    {
      id: "v0.2",
      version: "v0.2",
      date: "2026-08-08",
      title: "公测版 v0.2",
      groups: [
        {
          id: "characters",
          title: "角色与技能",
          items: [
            {
              id: "shamisen",
              title: "新增角色「三味线」",
              body: "新增主舰被动“猫爪印记”，持续标记一名敌舰；全舰队会优先锁定，子弹与攻击命中特效对其造成双倍伤害，目标被击杀后自动转移标记。技能、状态效果及碰撞伤害不受该倍率影响。分舰技能“猫爪乱舞”可用猫爪弹叠加抓痕并引爆额外伤害。",
            },
            {
              id: "yuki-flagship",
              title: "重做「长门有希」主舰技能",
              body: "“资讯统合雷达”被动持续以雷达波扫描全图，识别敌人动向；距离越近识别越精确，在较近距离内还可显现敌方舰队角色名。同时，己方释放的侦察机强化为战斗僚机，具有更大的视野和一定战斗能力。",
            },
            {
              id: "asakura-flagship",
              title: "重做「朝仓凉子」主舰技能",
              body: "“资讯压制”会在数秒内持续释放波动，涤除波动接触到的敌舰的正面增益，并显示其视野。",
            },
            {
              id: "future1096-flagship",
              title: "重做「朝比奈实玖瑠」主舰技能",
              body: "“过去与未来的我”使舰队获得可切换的双形态：形态 A 具有更高射速、受到更多伤害、速度更快；形态 B 具有更低射速、受到更少伤害、速度更慢。",
            },
          ],
        },
        {
          id: "battle",
          title: "战役与对战",
          items: [
            {
              id: "tutorial",
              title: "新增独立新手教程",
              body: "新增了专门的新手教程关卡，可循序学习舰队航行、侦察、分舰与交战。",
            },
            {
              id: "network",
              title: "优化多人网络性能",
              body: "优化了多人对战时的网络性能，降低持续对战与观战时的传输开销。",
            },
            {
              id: "spawns",
              title: "调整初始出生位置",
              body: "将对战双方的初始出生位置向后调整，以增加开局时的迂回空间。",
            },
          ],
        },
        {
          id: "controls",
          title: "操作与智能",
          items: [
            {
              id: "throttle",
              title: "航速改为档位制",
              body: "将舰船速度控制调整为更方便操作的档位制，可通过快捷键直接切换。",
            },
            {
              id: "ai-energy",
              title: "优化 AI 能量管理",
              body: "AI 会更合理地控制能量消耗，并在低能量时主动恢复。",
            },
            {
              id: "mobile-scout",
              title: "优化移动端侦察机交互",
              body: "现在可以拖拽释放侦察机的按钮来选择目标战区，轻点则选择中央战区。",
            },
          ],
        },
      ],
    },
  ],
  ja: [
    {
      id: "v0.3",
      version: "v0.3",
      date: "2026-08-13",
      title: "公開テスト版 v0.3",
      groups: [
        {
          id: "characters",
          title: "キャラクターと技能",
          items: [
            {
              id: "haruhi-flagship",
              title: "「涼宮ハルヒ」の主艦技能を刷新",
              body: "「私はここにいる！」を発動すると、味方艦隊の位置をすべての敵へ知らせる代わりに、味方艦隊全体の能力を強化します。さらに宇宙人・未来人・異世界人・超能力者の中から1人をランダムに見つけ、艦隊へ永続的な強化を与えます。",
            },
            {
              id: "koizumi-sub",
              title: "「古泉一樹」の分艦技能を刷新",
              body: "「超能力粒子」を発動すると、古泉は速度と機動性が大幅に高まった光球へ変化し、射撃不能になる代わりにダメージを受けません。敵艦との接触でノックバックと5秒間の沈黙を与え、終了後は光球のまま戦場中央へ帰還します。",
            },
            {
              id: "koizumi-flagship",
              title: "「古泉一樹」の主艦技能を刷新",
              body: "「超能力バリア」は自身の視界境界に障壁を常時展開し、外側から飛来する弾丸やビームを遮断します。ただし、艦体による突撃系技能を受けると破壊されます。",
            },
            {
              id: "shamisen-flagship",
              title: "「シャミセン」の主艦技能を追加",
              body: "「猫の爪印」は開幕時に敵1人をランダムに標識し、その対象へ味方艦隊が与える弾丸ダメージを2倍にします。標識対象を撃破すると、別の敵へランダムに標識が移ります。",
            },
            {
              id: "haruhi-sub",
              title: "「涼宮ハルヒ」の分艦技能を刷新",
              body: "「勇者の力」は短いチャージ後に周囲へ衝撃波を放ち、命中した敵へ順にスタンと減速を与えます。弱体効果が続く間は、対象が受けるダメージも増加します。",
            },
          ],
        },
        {
          id: "balance",
          title: "バランスと AI",
          items: [
            {
              id: "yuki-flagship",
              title: "「長門有希」の主艦技能を強化",
              body: "主艦時に一度の発進で展開する戦闘僚機を2機へ増やし、「情報統合レーダー」の走査速度を大幅に引き上げました。",
            },
            {
              id: "future1096-sub",
              title: "「朝比奈みくる」の分艦技能を調整",
              body: "「1096ビーム」が複数の敵へ同時命中した際のダメージを適度に引き下げました。",
            },
            {
              id: "asakura-sub",
              title: "「朝倉涼子」の分艦技能を強化",
              body: "「ブレードクイーン」のダメージと効果範囲を適度に引き上げました。",
            },
            {
              id: "character-ai",
              title: "キャラクター AI を改善",
              body: "一部キャラクターに対する AI の操作と対処戦略を改善しました。",
            },
          ],
        },
        {
          id: "systems",
          title: "システムと性能",
          items: [
            {
              id: "winrate-statistics",
              title: "編成勝率統計システムを追加",
              body: "シングルプレイとマルチプレイの編成別出撃数・勝率を集計し、ランキングで確認できるようになりました。",
            },
            {
              id: "webgl2",
              title: "WebGL2 を優先描画経路に変更",
              body: "戦場の優先描画経路を WebGL2 へ切り替え、描画性能を向上させました。",
            },
          ],
        },
      ],
    },
    {
      id: "v0.2",
      version: "v0.2",
      date: "2026-08-08",
      title: "公開テスト版 v0.2",
      groups: [
        {
          id: "characters",
          title: "キャラクターと技能",
          items: [
            {
              id: "shamisen",
              title: "新キャラクター「シャミセン」",
              body: "主艦パッシブ「猫の爪印」を追加。敵1隻を継続追跡して優先ロックし、味方の弾丸と命中時の攻撃効果が2倍ダメージを与えます。技能・状態効果・衝突ダメージは増幅されません。撃破後は次の敵へ標識が移ります。分艦技能「猫爪乱舞」は猫爪弾で爪痕を重ね、追加ダメージを炸裂させます。",
            },
            {
              id: "yuki-flagship",
              title: "「長門有希」の主艦技能を刷新",
              body: "「情報統合レーダー」はレーダー波で全域を常時走査し、敵の動向を識別します。距離が近いほど精度が上がり、近距離では敵艦隊のキャラクター名も表示します。さらに味方の偵察機は、広い視界と一定の戦闘能力を持つ戦闘僚機に強化されます。",
            },
            {
              id: "asakura-flagship",
              title: "「朝倉涼子」の主艦技能を刷新",
              body: "「情報制圧」は数秒間にわたって波動を放ち続け、接触した敵艦の有利な強化効果を解除し、その地点の視界を獲得します。",
            },
            {
              id: "future1096-flagship",
              title: "「朝比奈みくる」の主艦技能を刷新",
              body: "「過去と未来の私」で艦隊を二つの形態に切り替えられます。形態 A は射速と速度が高い代わりに受けるダメージが増加し、形態 B は射速と速度が低い代わりに受けるダメージが減少します。",
            },
          ],
        },
        {
          id: "battle",
          title: "キャンペーンと対戦",
          items: [
            {
              id: "tutorial",
              title: "独立した初心者チュートリアル",
              body: "航行・偵察・分艦・交戦を段階的に学べる専用チュートリアルステージを追加しました。",
            },
            {
              id: "network",
              title: "オンライン対戦の通信性能を改善",
              body: "オンライン対戦と観戦を長時間続けた際の通信負荷を軽減しました。",
            },
            {
              id: "spawns",
              title: "初期出現位置を調整",
              body: "開幕時の迂回空間を広げるため、両陣営の初期位置をそれぞれ後方へ移動しました。",
            },
          ],
        },
        {
          id: "controls",
          title: "操作と AI",
          items: [
            {
              id: "throttle",
              title: "航速をギア方式に変更",
              body: "艦船の速度操作を扱いやすいギア方式に変更し、ショートカットキーで直接切り替えられるようにしました。",
            },
            {
              id: "ai-energy",
              title: "AI のエネルギー管理を改善",
              body: "AI が消費量をより合理的に制御し、エネルギー低下時には自発的に回復するようになりました。",
            },
            {
              id: "mobile-scout",
              title: "モバイル偵察機の操作を改善",
              body: "偵察機ボタンをドラッグして目標戦区を選択できるようになりました。軽くタップすると中央戦区を選択します。",
            },
          ],
        },
      ],
    },
  ],
  en: [
    {
      id: "v0.3",
      version: "v0.3",
      date: "2026-08-13",
      title: "Public Beta v0.3",
      groups: [
        {
          id: "characters",
          title: "Characters & Abilities",
          items: [
            {
              id: "haruhi-flagship",
              title: "Haruhi Suzumiya Flagship Rework",
              body: "Activating “I'm Here!” reveals the allied fleet's position to every enemy while granting broad stat bonuses to the fleet. Haruhi also randomly finds an Alien, Time Traveler, Otherworlder, or Esper, providing a permanent positive enhancement.",
            },
            {
              id: "koizumi-sub",
              title: "Itsuki Koizumi Sub-ship Rework",
              body: "Activating “Esper Particles” transforms Koizumi into a dramatically faster and more agile orb. He cannot fire but takes no damage; colliding with an enemy knocks it back and silences it for 5 seconds. When the skill ends, the orb returns to the battlefield center.",
            },
            {
              id: "koizumi-flagship",
              title: "Itsuki Koizumi Flagship Rework",
              body: "“Esper Barrier” passively creates a barrier along Koizumi's vision boundary. It intercepts bullets and beams fired from outside, but ship-impact abilities can break it.",
            },
            {
              id: "shamisen-flagship",
              title: "New Shamisen Flagship Ability",
              body: "“Claw Mark” randomly marks one enemy at the start of battle, doubling projectile damage dealt to that target by the allied fleet. Defeating the marked target transfers the mark to another random enemy character.",
            },
            {
              id: "haruhi-sub",
              title: "Haruhi Suzumiya Sub-ship Rework",
              body: "After a short charge, “Hero Power” releases a nearby shockwave that first stuns and then slows affected enemies. Targets also take increased damage for the full duration of the debuff.",
            },
          ],
        },
        {
          id: "balance",
          title: "Balance & AI",
          items: [
            {
              id: "yuki-flagship",
              title: "Yuki Nagato Flagship Buff",
              body: "Flagship launches now deploy two combat wingmen at a time, and Data Integration Radar scans substantially faster.",
            },
            {
              id: "future1096-sub",
              title: "Mikuru Asahina Sub-ship Adjustment",
              body: "Reduced the damage dealt by 1096 Beam when it hits multiple enemies at once.",
            },
            {
              id: "asakura-sub",
              title: "Ryoko Asakura Sub-ship Buff",
              body: "Moderately increased Blade Queen's damage and effect radius.",
            },
            {
              id: "character-ai",
              title: "Improved Character AI",
              body: "Improved how AI controls and counters several character-specific abilities.",
            },
          ],
        },
        {
          id: "systems",
          title: "Systems & Performance",
          items: [
            {
              id: "winrate-statistics",
              title: "Lineup Win-rate Statistics",
              body: "Added lineup pick counts, win-rate tracking, and leaderboard views for both single-player and multiplayer battles.",
            },
            {
              id: "webgl2",
              title: "WebGL2 Is Now the Preferred Renderer",
              body: "The battlefield now prefers the WebGL2 rendering path for improved rendering performance.",
            },
          ],
        },
      ],
    },
    {
      id: "v0.2",
      version: "v0.2",
      date: "2026-08-08",
      title: "Public Beta v0.2",
      groups: [
        {
          id: "characters",
          title: "Characters & Abilities",
          items: [
            {
              id: "shamisen",
              title: "New Character: Shamisen",
              body: "Adds the flagship passive “Claw Mark,” continuously marking one enemy for priority lock. Allied projectiles and on-hit attack effects deal double damage, while skills, status effects, and collision damage are not amplified. The mark moves after a kill. His sub-ship skill “Claw Barrage” stacks and detonates claw marks for bonus damage.",
            },
            {
              id: "yuki-flagship",
              title: "Yuki Nagato Flagship Rework",
              body: "“Data Integration Radar” continuously sweeps the entire map and identifies enemy movement. Contacts become more accurate at closer range, and nearby fleets also reveal their character names. Allied scouts are additionally upgraded into combat wingmen with wider vision and limited combat capability.",
            },
            {
              id: "asakura-flagship",
              title: "Ryoko Asakura Flagship Rework",
              body: "“Information Suppression” emits repeated waves for several seconds. Each wave removes positive buffs from enemy ships it touches and grants vision along its path.",
            },
            {
              id: "future1096-flagship",
              title: "Mikuru Asahina Flagship Rework",
              body: "“My Past and Future Selves” lets the fleet switch between two forms. Form A fires and moves faster but takes more damage; Form B fires and moves slower but takes less damage.",
            },
          ],
        },
        {
          id: "battle",
          title: "Campaign & Battle",
          items: [
            {
              id: "tutorial",
              title: "Standalone Beginner Tutorial",
              body: "A dedicated tutorial stage now teaches navigation, scouting, fleet splitting, and combat step by step.",
            },
            {
              id: "network",
              title: "Improved Multiplayer Networking",
              body: "Network performance has been improved to reduce transmission overhead during extended battles and spectating sessions.",
            },
            {
              id: "spawns",
              title: "Adjusted Starting Positions",
              body: "Both fleets now begin farther back, creating more room to maneuver during the opening phase.",
            },
          ],
        },
        {
          id: "controls",
          title: "Controls & AI",
          items: [
            {
              id: "throttle",
              title: "Gear-based Speed Controls",
              body: "Ship speed now uses a more convenient gear system with direct keyboard shortcuts.",
            },
            {
              id: "ai-energy",
              title: "Improved AI Energy Management",
              body: "AI fleets now manage energy expenditure more sensibly and actively recover when reserves run low.",
            },
            {
              id: "mobile-scout",
              title: "Improved Mobile Scout Controls",
              body: "Drag the scout button to choose a target zone, or tap it to select the center zone.",
            },
          ],
        },
      ],
    },
  ],
});

export function getChangelogEntries(locale = "zh") {
  return CHANGELOG_BY_LOCALE[locale] || CHANGELOG_BY_LOCALE.zh;
}
