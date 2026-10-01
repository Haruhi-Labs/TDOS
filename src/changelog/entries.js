// 更新日志内容与展示层分离：新增版本时按相同 id 同步补齐 zh / ja / en，页面无需改动。
// 只有用户明确要求时才可新增日志；用户提供的中文正文必须逐字录入，不得润色、概括或补写。
// 允许整理分类、小标题及必要的等义翻译，但翻译不得增删信息或引入尚未发布的内容。

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const CHANGELOG_BY_LOCALE = deepFreeze({
  zh: [
    {
      "id": "v0.4",
      "version": "v0.4",
      "date": "2026-10-01",
      "title": "公测版 v0.4",
      "groups": [
        {
          "id": "characters",
          "title": "角色与平衡调整",
          "items": [
            {
              "id": "koizumi-flagship",
              "title": "古泉一树 · 主舰技",
              "text": "主舰技「超能力屏障」：改为可拦截 15 次的次数盾。护盾被击破后，需要连续 5 秒没有敌方子弹穿过原护盾边界才会修复。"
            },
            {
              "id": "koizumi-sub",
              "title": "古泉一树 · 分舰技",
              "text": "分舰技「超能力粒子」：撞击时新增能量波，波及的敌舰眩晕 1 秒。技能期间免疫控制效果。"
            },
            {
              "id": "asakura-flagship",
              "title": "朝仓凉子 · 主舰技",
              "text": "主舰技「资讯压制」：视野波现在可以驱散友军的负面状态，同时保留对敌方主动增益的涤除效果。"
            },
            {
              "id": "asakura-sub",
              "title": "朝仓凉子 · 分舰技",
              "text": "分舰技「刀锋女王」：技能期间航速不低于强化后的三档满能量航速，被控制的状态下也会继续飞行。接触伤害固定为目标最大生命值的 15%。"
            },
            {
              "id": "shamisen-flagship",
              "title": "三味线",
              "text": "主舰技「猫爪印记」：伤害倍率由 2 倍下调至 1.5 倍。"
            },
            {
              "id": "yuki-flagship",
              "title": "长门有希",
              "text": "主舰技：每次释放的战斗侦察机由 2 架减为 1 架。"
            }
          ]
        },
        {
          "id": "spectator",
          "title": "观战模式",
          "items": [
            {
              "id": "layout",
              "title": "观战界面改版",
              "text": "观战界面改版：战场放在中间，双方舰队信息分列左右。进入房间就能看到双方玩家和完整阵容。观战时实时显示每艘舰船的舰体、能量、技能状态和冷却。"
            },
            {
              "id": "camera",
              "title": "观战镜头优化",
              "text": "观战镜头优化：镜头移动更平滑，方便赛事观战和直播取景。"
            },
            {
              "id": "effects",
              "title": "观战特效修复",
              "text": "观战特效修复：修复观战中部分特效、动画消失的问题。"
            }
          ]
        },
        {
          "id": "controls",
          "title": "对战操作与技能展示",
          "items": [
            {
              "id": "panel",
              "title": "操作面板重构",
              "text": "操作面板重构：突出重点操作，更加简洁好用。"
            },
            {
              "id": "selection",
              "title": "受控选舰修复",
              "text": "受控选舰修复：修复眩晕、震慑期间操作焦点自动切到其他舰船的问题。"
            },
            {
              "id": "brake",
              "title": "移除「急刹」",
              "text": "移除「急刹」功能。"
            },
            {
              "id": "status",
              "title": "状态图标统一",
              "text": "状态图标统一：桌面端对战和观战时均能看到角色身上的正面/负面状态。"
            }
          ]
        },
        {
          "id": "visuals",
          "title": "画面与界面",
          "items": [
            {
              "id": "resolution",
              "title": "战场清晰度提升",
              "text": "战场清晰度提升：在大屏、高分屏或镜头放大时，图像显示更锐利。"
            },
            {
              "id": "language",
              "title": "语言菜单优化",
              "text": "语言菜单优化：首页语言下拉菜单更易读，风格与整体界面统一。"
            }
          ]
        },
        {
          "id": "statistics",
          "title": "统计",
          "items": [
            {
              "id": "versions",
              "title": "胜率可按版本查看",
              "text": "胜率可按版本查看：新版本胜率单独统计，原始历史记录完整保留。"
            }
          ]
        }
      ]
    },
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
              text: "重做角色「凉宫春日」的主舰技能“我在这里”，开启后向所有敌人昭示己方舰队位置，给予己方舰队整体数值提升，并从宇宙人、未来人、异世界人、超能力者中随机找到一位，给予常驻的正面增强。",
            },
            {
              id: "koizumi-sub",
              title: "重做「古泉一树」分舰技能",
              text: "重做角色「古泉一树」的分舰技能“超能力粒子”，开启后使古泉化作一颗速度和机动大幅增强的光球，无法射击也不会受到伤害，碰撞敌方可造成击退以及5秒钟的沉默，技能结束后回归战场中央。",
            },
            {
              id: "koizumi-flagship",
              title: "重做「古泉一树」主舰技能",
              text: "重做角色「古泉一树」的主舰技能“超能力屏障”，被动在自己的视野边界创造屏障，可拦截屏障外射来的子弹或光线，但会被舰体冲击类技能打破。",
            },
            {
              id: "shamisen-flagship",
              title: "新增「三味线」主舰技能",
              text: "新增角色「三味线」的主舰技能“猫爪印记”，开局时随机标记出一位敌人，己方舰队对其造成的子弹伤害翻倍，击破标记目标时将转移标记至敌方另一位随机角色。",
            },
            {
              id: "haruhi-sub",
              title: "重做「凉宫春日」分舰技能",
              text: "重做角色「凉宫春日」的分舰技能“勇者之力”，短暂蓄力后向附近释放冲击，对被冲击到的敌人先后造成眩晕与减速，在整个负面效果持续期间为敌方施加易伤。",
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
              text: "将「长门有希」主舰每次释放的战斗僚机改为两艘，并大幅增加其雷达扫描速度。",
            },
            {
              id: "future1096-sub",
              title: "调整「朝比奈实玖瑠」分舰技能",
              text: "将「朝比奈实玖瑠」的分舰技能命中多个敌人时造成的伤害适当下调。",
            },
            {
              id: "asakura-sub",
              title: "加强「朝仓凉子」分舰技能",
              text: "将「朝仓凉子」的分舰技能的伤害与范围适当上调。",
            },
            {
              id: "character-ai",
              title: "优化角色 AI",
              text: "优化了AI对于一些角色的操控和应对。",
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
              text: "接入阵容胜率统计系统。",
            },
            {
              id: "webgl2",
              title: "首选 WebGL2 渲染路径",
              text: "将首选渲染路径切换至WebGL2以提升性能。",
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
              text: "新增角色「三味线」，分舰技能“猫爪乱舞”，开启后自身子弹变为猫爪，命中同一敌舰数次后引爆抓痕，造成额外伤害。主舰技能仍在设计中。",
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
      "id": "v0.4",
      "version": "v0.4",
      "date": "2026-10-01",
      "title": "公開テスト版 v0.4",
      "groups": [
        {
          "id": "characters",
          "title": "キャラクターとバランス調整",
          "items": [
            {
              "id": "koizumi-flagship",
              "title": "古泉一樹 · 主艦スキル",
              "text": "主艦スキル「超能力障壁」：15回の攻撃を遮断する回数制のシールドに変更。破壊後は、敵の弾が元のシールド境界を通過しない状態が5秒間連続して続くと修復されます。"
            },
            {
              "id": "koizumi-sub",
              "title": "古泉一樹 · 分艦スキル",
              "text": "分艦スキル「超能力粒子」：衝突時にエネルギー波が発生し、波に触れた敵艦を1秒間スタンさせます。スキル中は行動妨害を受けません。"
            },
            {
              "id": "asakura-flagship",
              "title": "朝倉涼子 · 主艦スキル",
              "text": "主艦スキル「情報制圧」：視野波が味方の弱体効果も解除するようになり、敵の能動的な強化効果を解除する効果も維持されます。"
            },
            {
              "id": "asakura-sub",
              "title": "朝倉涼子 · 分艦スキル",
              "text": "分艦スキル「刃の女王」：スキル中の速度は、強化後のエネルギー満タン時のギア3速度を下回りません。行動妨害中も飛行を続けます。接触ダメージは対象の最大船体耐久値の15%に固定されます。"
            },
            {
              "id": "shamisen-flagship",
              "title": "シャミセン",
              "text": "主艦スキル「猫の爪印」：ダメージ倍率を2倍から1.5倍に引き下げました。"
            },
            {
              "id": "yuki-flagship",
              "title": "長門有希",
              "text": "主艦スキル：一度に発進する戦闘偵察機を2機から1機に減らしました。"
            }
          ]
        },
        {
          "id": "spectator",
          "title": "観戦モード",
          "items": [
            {
              "id": "layout",
              "title": "観戦画面の刷新",
              "text": "観戦画面の刷新：中央に戦場を配置し、左右に両艦隊の情報を表示します。ルームに入ると双方のプレイヤーと全編成を確認できます。観戦中は各艦の船体耐久、エネルギー、スキル状態とクールダウンをリアルタイムで表示します。"
            },
            {
              "id": "camera",
              "title": "観戦カメラの改善",
              "text": "観戦カメラの改善：カメラの移動が滑らかになり、大会の観戦やライブ配信での画面構成がしやすくなりました。"
            },
            {
              "id": "effects",
              "title": "観戦エフェクトの修正",
              "text": "観戦エフェクトの修正：観戦中に一部のエフェクトやアニメーションが消える問題を修正しました。"
            }
          ]
        },
        {
          "id": "controls",
          "title": "対戦操作とスキル表示",
          "items": [
            {
              "id": "panel",
              "title": "操作パネルの刷新",
              "text": "操作パネルの刷新：重要な操作を目立たせ、より簡潔で使いやすくしました。"
            },
            {
              "id": "selection",
              "title": "行動妨害中の艦選択の修正",
              "text": "行動妨害中の艦選択の修正：スタンや震慑の間に操作対象が自動的に別の艦へ切り替わる問題を修正しました。"
            },
            {
              "id": "brake",
              "title": "「急ブレーキ」の削除",
              "text": "「急ブレーキ」機能を削除しました。"
            },
            {
              "id": "status",
              "title": "状態アイコンの統一",
              "text": "状態アイコンの統一：デスクトップの対戦と観戦の両方で、キャラクターの強化・弱体状態を確認できます。"
            }
          ]
        },
        {
          "id": "visuals",
          "title": "描画とインターフェース",
          "items": [
            {
              "id": "resolution",
              "title": "戦場の鮮明さ向上",
              "text": "戦場の鮮明さ向上：大型画面、高解像度画面、カメラ拡大時の画像がより鮮明になります。"
            },
            {
              "id": "language",
              "title": "言語メニューの改善",
              "text": "言語メニューの改善：ホーム画面の言語選択メニューが読みやすくなり、画面全体のデザインに統一しました。"
            }
          ]
        },
        {
          "id": "statistics",
          "title": "統計",
          "items": [
            {
              "id": "versions",
              "title": "バージョン別の勝率",
              "text": "バージョン別の勝率：新しいバージョンの勝率を個別に集計し、元の過去記録はすべて保持します。"
            }
          ]
        }
      ]
    },
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
              text: "「私はここにいる！」を発動すると、味方艦隊の位置をすべての敵へ知らせ、味方艦隊全体の能力値を強化します。さらに宇宙人・未来人・異世界人・超能力者の中から1人をランダムに見つけ、永続的な強化を与えます。",
            },
            {
              id: "koizumi-sub",
              title: "「古泉一樹」の分艦技能を刷新",
              text: "「超能力粒子」を発動すると、古泉は速度と機動性が大幅に高まった光球へ変化し、射撃不能となりダメージも受けません。敵との接触でノックバックと5秒間の沈黙を与え、終了後は戦場中央へ帰還します。",
            },
            {
              id: "koizumi-flagship",
              title: "「古泉一樹」の主艦技能を刷新",
              text: "「超能力バリア」は自身の視界境界に障壁を常時展開し、外側から飛来する弾丸やビームを遮断します。ただし、艦体による突撃系技能を受けると破壊されます。",
            },
            {
              id: "shamisen-flagship",
              title: "「シャミセン」の主艦技能を追加",
              text: "「猫の爪印」は開幕時に敵1人をランダムに標識し、その対象へ味方艦隊が与える弾丸ダメージを2倍にします。標識対象を撃破すると、別の敵キャラクターへランダムに標識が移ります。",
            },
            {
              id: "haruhi-sub",
              title: "「涼宮ハルヒ」の分艦技能を刷新",
              text: "「勇者の力」は短いチャージ後に周囲へ衝撃を放ち、命中した敵へ順にスタンと減速を与えます。弱体効果が続く間は、対象の被ダメージも増加します。",
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
              text: "「長門有希」主艦が一度に発進させる戦闘僚機を2機へ変更し、レーダーの走査速度を大幅に引き上げました。",
            },
            {
              id: "future1096-sub",
              title: "「朝比奈みくる」の分艦技能を調整",
              text: "「朝比奈みくる」の分艦技能が複数の敵へ命中した際のダメージを適度に引き下げました。",
            },
            {
              id: "asakura-sub",
              title: "「朝倉涼子」の分艦技能を強化",
              text: "「朝倉涼子」の分艦技能のダメージと効果範囲を適度に引き上げました。",
            },
            {
              id: "character-ai",
              title: "キャラクター AI を改善",
              text: "一部キャラクターに対するAIの操作と対処を改善しました。",
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
              text: "編成勝率統計システムを導入しました。",
            },
            {
              id: "webgl2",
              title: "WebGL2 を優先描画経路に変更",
              text: "性能向上のため、優先描画経路をWebGL2へ切り替えました。",
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
              text: "分艦技能「猫爪乱舞」を追加。発動中は自身の弾丸が猫の爪となり、同じ敵艦へ数回命中すると爪痕が炸裂して追加ダメージを与えます。主艦技能は引き続き設計中です。",
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
      "id": "v0.4",
      "version": "v0.4",
      "date": "2026-10-01",
      "title": "Public beta v0.4",
      "groups": [
        {
          "id": "characters",
          "title": "Characters and Balance",
          "items": [
            {
              "id": "koizumi-flagship",
              "title": "Itsuki Koizumi · Flagship Ability",
              "text": "Flagship ability “Psychic Barrier”: The shield now intercepts 15 hits. After it breaks, it only repairs after 5 consecutive seconds with no enemy bullets crossing its original boundary."
            },
            {
              "id": "koizumi-sub",
              "title": "Itsuki Koizumi · Subship Ability",
              "text": "Subship ability “Psychic Particle”: Collisions now emit an energy wave that stuns affected enemy ships for 1 second. Control effects are ignored during the ability."
            },
            {
              "id": "asakura-flagship",
              "title": "Ryoko Asakura · Flagship Ability",
              "text": "Flagship ability “Information Suppression”: Vision waves can now dispel negative effects from allies while retaining their ability to remove active buffs from enemies."
            },
            {
              "id": "asakura-sub",
              "title": "Ryoko Asakura · Subship Ability",
              "text": "Subship ability “Blade Queen”: During the ability, speed stays at or above the enhanced gear-3 speed at full energy, and the ship keeps flying even while controlled. Contact damage is fixed at 15% of the target’s maximum hull."
            },
            {
              "id": "shamisen-flagship",
              "title": "Shamisen",
              "text": "Flagship ability “Claw Mark”: The damage multiplier is reduced from 2× to 1.5×."
            },
            {
              "id": "yuki-flagship",
              "title": "Yuki Nagato",
              "text": "Flagship ability: Each launch now releases 1 combat scout instead of 2."
            }
          ]
        },
        {
          "id": "spectator",
          "title": "Spectator Mode",
          "items": [
            {
              "id": "layout",
              "title": "Spectator Interface Redesign",
              "text": "Spectator interface redesign: The battlefield is centered between the two fleets’ information panels. Both players and their complete lineups are visible upon entering a room. Every ship’s hull, energy, ability state, and cooldown are displayed in real time."
            },
            {
              "id": "camera",
              "title": "Spectator Camera Improvements",
              "text": "Spectator camera improvements: Smoother camera movement makes it easier to frame matches for spectating and live broadcasts."
            },
            {
              "id": "effects",
              "title": "Spectator Effects Fixes",
              "text": "Spectator effects fixes: Fixed missing effects and animations in spectator mode."
            }
          ]
        },
        {
          "id": "controls",
          "title": "Battle Controls and Ability Display",
          "items": [
            {
              "id": "panel",
              "title": "Control Panel Rework",
              "text": "Control panel rework: Key actions are more prominent, with a simpler and easier-to-use layout."
            },
            {
              "id": "selection",
              "title": "Ship Selection under Control Effects",
              "text": "Ship selection under control effects: Fixed input focus automatically switching to another ship during stuns and shock effects."
            },
            {
              "id": "brake",
              "title": "Emergency Brake Removal",
              "text": "Removed the “Emergency Brake” feature."
            },
            {
              "id": "status",
              "title": "Unified Status Icons",
              "text": "Unified status icons: Desktop battle and spectator views both show characters’ positive and negative status effects."
            }
          ]
        },
        {
          "id": "visuals",
          "title": "Graphics and Interface",
          "items": [
            {
              "id": "resolution",
              "title": "Sharper Battlefields",
              "text": "Sharper battlefields: Images are sharper on large screens, high-resolution displays, and when the camera is zoomed in."
            },
            {
              "id": "language",
              "title": "Language Menu Improvements",
              "text": "Language menu improvements: The home screen’s language dropdown is easier to read and better matches the overall interface."
            }
          ]
        },
        {
          "id": "statistics",
          "title": "Statistics",
          "items": [
            {
              "id": "versions",
              "title": "Win Rates by Version",
              "text": "Win rates by version: Each new version has separate win-rate statistics, while all original historical records are preserved."
            }
          ]
        }
      ]
    },
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
              text: "Activating “I'm Here!” reveals the allied fleet's position to every enemy, grants broad stat bonuses to the allied fleet, and randomly finds an Alien, Time Traveler, Otherworlder, or Esper to provide a permanent positive enhancement.",
            },
            {
              id: "koizumi-sub",
              title: "Itsuki Koizumi Sub-ship Rework",
              text: "Activating “Esper Particles” transforms Koizumi into a dramatically faster and more agile orb that cannot fire or take damage. Colliding with an enemy knocks it back and silences it for 5 seconds. When the ability ends, Koizumi returns to the battlefield center.",
            },
            {
              id: "koizumi-flagship",
              title: "Itsuki Koizumi Flagship Rework",
              text: "“Esper Barrier” passively creates a barrier along Koizumi's vision boundary. It intercepts bullets and beams fired from outside, but ship-impact abilities can break it.",
            },
            {
              id: "shamisen-flagship",
              title: "New Shamisen Flagship Ability",
              text: "“Claw Mark” randomly marks one enemy at the start of battle, doubling projectile damage dealt to that target by the allied fleet. Defeating the marked target transfers the mark to another random enemy character.",
            },
            {
              id: "haruhi-sub",
              title: "Haruhi Suzumiya Sub-ship Rework",
              text: "After a short charge, “Hero Power” releases a nearby shockwave that first stuns and then slows affected enemies. Targets also take increased damage for the full duration of the debuff.",
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
              text: "Yuki Nagato's flagship now deploys two combat wingmen per launch, and its radar scans substantially faster.",
            },
            {
              id: "future1096-sub",
              title: "Mikuru Asahina Sub-ship Adjustment",
              text: "Moderately reduced the damage of Mikuru Asahina's sub-ship ability when it hits multiple enemies.",
            },
            {
              id: "asakura-sub",
              title: "Ryoko Asakura Sub-ship Buff",
              text: "Moderately increased the damage and range of Ryoko Asakura's sub-ship ability.",
            },
            {
              id: "character-ai",
              title: "Improved Character AI",
              text: "Improved how AI controls and counters several characters.",
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
              text: "Added a lineup win-rate statistics system.",
            },
            {
              id: "webgl2",
              title: "WebGL2 Is Now the Preferred Renderer",
              text: "Switched the preferred rendering path to WebGL2 for improved performance.",
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
              text: "Adds the sub-ship ability “Claw Barrage.” While active, Shamisen's bullets become cat paws; hitting the same enemy ship several times detonates the claw marks for bonus damage. The flagship ability is still in development.",
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
